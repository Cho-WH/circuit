import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  cloneDocument,
  documentMigrator,
  validateDocument,
  type Annotation,
  type CircuitDocument,
} from "../src/domain";
import { createComponent, terminalPosition, wirePoints } from "../src/component-library";
import {
  copySelection,
  createHistory,
  executeCommand,
  parseValue,
  previewCommand,
  redo,
  undo,
  type Command,
  type History,
} from "../src/editor";
import {
  loadLocal,
  parseDocument,
  saveLocal,
  serializeDocument,
} from "../src/persistence";

const root = resolve(process.cwd());

function fixture(id: string): CircuitDocument {
  const filename = [
    "FIX-01-single-resistor.json",
    "FIX-02-series.json",
    "FIX-03-parallel.json",
  ].find((name) => name.startsWith(id));
  if (!filename) throw new Error(`Fixture not routed: ${id}`);
  const parsed = JSON.parse(readFileSync(join(root, "fixtures", filename), "utf8")) as {
    document: CircuitDocument;
  };
  return documentMigrator.migrate(parsed.document);
}

function mustExecute(history: History, command: Command): History {
  const result = executeCommand(history, command);
  expect(result).toEqual(expect.objectContaining({ ok: true }));
  if (!result.ok) throw new Error(result.diagnostics.map(({ code }) => code).join(", "));
  return result.history;
}

function allDocumentIds(document: CircuitDocument): Set<string> {
  return new Set([
    ...document.components.map(({ id }) => id),
    ...document.components.flatMap(({ terminals }) => terminals.map(({ id }) => id)),
    ...document.wires.map(({ id }) => id),
    ...document.junctions.map(({ id }) => id),
    ...document.annotations.map(({ id }) => id),
  ]);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  getFailure: Error | null = null;
  setFailure: Error | null = null;

  getItem(key: string): string | null {
    if (this.getFailure) throw this.getFailure;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.setFailure) throw this.setFailure;
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

describe("immutable editor commands", () => {
  it("creates detached history and never mutates a frozen input snapshot", () => {
    const source = deepFreeze(fixture("FIX-01"));
    const history = deepFreeze(createHistory(source));
    const before = JSON.stringify(history);

    const result = executeCommand(history, {
      type: "SetProperties",
      id: "R1",
      properties: { resistanceOhm: 18 },
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(history)).toBe(before);
    expect(source.components.find(({ id }) => id === "R1")!.properties.resistanceOhm).toBe(9);
    if (!result.ok) return;
    expect(result.history.present.components.find(({ id }) => id === "R1")!.properties.resistanceOhm).toBe(18);
    expect(result.history.present).not.toBe(history.present);
  });

  it("preserves at least 100 commands through complete undo and redo", () => {
    const initial = fixture("FIX-01");
    let history = createHistory(initial);

    for (let index = 1; index <= 125; index += 1) {
      history = mustExecute(history, {
        type: "SetLabel",
        id: "R1",
        label: `R-${index}`,
      });
    }
    const final = cloneDocument(history.present);
    expect(history.past).toHaveLength(125);

    for (let index = 0; index < 125; index += 1) history = undo(history);
    expect(history.present).toStrictEqual(initial);
    expect(history.future).toHaveLength(125);

    for (let index = 0; index < 125; index += 1) history = redo(history);
    expect(history.present).toStrictEqual(final);
    expect(history.past).toHaveLength(125);
    expect(history.future).toEqual([]);
  });

  it("clears redo history when a new command follows undo", () => {
    let history = createHistory(fixture("FIX-01"));
    history = mustExecute(history, { type: "SetLabel", id: "R1", label: "first" });
    history = mustExecute(history, { type: "SetLabel", id: "R1", label: "second" });
    history = undo(history);
    expect(history.future).toHaveLength(1);

    history = mustExecute(history, { type: "SetLabel", id: "R1", label: "branch" });
    expect(history.future).toEqual([]);
    expect(redo(history)).toBe(history);
  });

  it("leaves history unchanged when a command target is absent", () => {
    const history = createHistory(fixture("FIX-01"));
    const before = JSON.stringify(history);
    const result = executeCommand(history, {
      type: "MoveComponents",
      positions: { missing: { x: 1, y: 2 } },
    });

    expect(result).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "COMMAND_TARGET_NOT_FOUND", affectedIds: ["missing"] }),
      ]),
    });
    expect(JSON.stringify(history)).toBe(before);
  });
});

describe("structural editor invariants", () => {
  it("positions voltage-source polarity by terminal role when imported order is reversed", () => {
    const source = cloneDocument(fixture("FIX-01")).components.find(({ id }) => id === "V1")!;
    source.rotation = 0;
    source.terminals.reverse();

    const positionsByRole = Object.fromEntries(
      source.terminals.map((terminal, index) => [terminal.role, terminalPosition(source, index)]),
    );

    expect(positionsByRole.positive.x).toBeLessThan(source.position.x);
    expect(positionsByRole.negative.x).toBeGreaterThan(source.position.x);
    expect(positionsByRole.positive.y).toBe(source.position.y);
    expect(positionsByRole.negative.y).toBe(source.position.y);
  });

  it("deleting a connected component preserves wires and remaps terminal anchors to junctions", () => {
    const document = cloneDocument(fixture("FIX-01"));
    const annotation: Annotation = {
      id: "A1",
      kind: "note",
      anchor: { kind: "terminal", id: "R1.a" },
      content: "keep this location",
      visibility: "always",
    };
    document.annotations.push(annotation);
    document.referenceNode = { kind: "terminal", id: "R1.b" };
    const history = mustExecute(createHistory(document), {
      type: "DeleteElements",
      ids: ["R1"],
    });

    expect(history.present.components.map(({ id }) => id)).toEqual(["V1"]);
    expect(history.present.wires).toHaveLength(document.wires.length + 1);
    expect(history.present.annotations).toHaveLength(1);
    expect(history.present.annotations[0].anchor?.kind).toBe('junction');
    expect(history.present.referenceNode?.kind).toBe('junction');
    expect(validateDocument(history.present).ok).toBe(true);
  });

  it.each([
    ["move", { type: "MoveComponents", positions: { R1: { x: 500, y: 200 } } }],
    ["rotate", { type: "RotateComponents", ids: ["R1"] }],
  ] as const)("preserves endpoints and repairs connected wire routes locally after %s", (_name, command) => {
    const document = cloneDocument(fixture("FIX-01"));
    document.wires[0].waypoints = [{ x: 10, y: 20 }];
    document.wires[1].waypoints = [{ x: 30, y: 40 }];
    const originalEndpoints = document.wires.map(({ start, end }) => ({ start, end }));

    const history = mustExecute(createHistory(document), command as Command);
    expect(history.present.wires.map(({ start, end }) => ({ start, end }))).toStrictEqual(
      originalEndpoints,
    );
    expect(history.present.wires[0].waypoints).toContainEqual({ x: 10, y: 20 });
    expect(history.present.wires[1].waypoints).toContainEqual({ x: 30, y: 40 });
    for (const wire of history.present.wires) {
      const points = wirePoints(history.present, wire);
      expect(points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y)).toBe(true);
    }

    const movedOrRotated = history.present.components.find(({ id }) => id === "R1")!;
    const firstTerminal = terminalPosition(movedOrRotated, 0);
    const secondTerminal = terminalPosition(movedOrRotated, 1);
    const wireToFirstTerminal = history.present.wires.find(({ id }) => id === "W1")!;
    const wireFromSecondTerminal = history.present.wires.find(({ id }) => id === "W2")!;
    expect(wirePoints(history.present, wireToFirstTerminal).at(-1)).toEqual(firstTerminal);
    expect(wirePoints(history.present, wireFromSecondTerminal)[0]).toEqual(secondTerminal);
  });

  it("copies only fully contained connectivity and assigns disjoint IDs", () => {
    const document = cloneDocument(fixture("FIX-02"));
    document.annotations.push({
      id: "A1",
      kind: "label",
      anchor: { kind: "junction", id: "J1" },
      content: "middle",
      visibility: "always",
    });
    let sequence = 0;
    const copied = copySelection(
      document,
      ["R1", "R2", "J1"],
      (prefix) => `copy-${prefix}-${++sequence}`,
      { x: 40, y: 50 },
    );

    expect(copied.components).toHaveLength(2);
    expect(copied.junctions).toHaveLength(1);
    expect(copied.wires).toHaveLength(2);
    expect(copied.annotations).toHaveLength(1);
    const originalIds = allDocumentIds(document);
    const copiedDocument: CircuitDocument = {
      ...cloneDocument(document),
      components: copied.components,
      wires: copied.wires,
      junctions: copied.junctions,
      annotations: copied.annotations,
      referenceNode: null,
    };
    const copiedIds = allDocumentIds(copiedDocument);
    expect([...copiedIds].every((id) => !originalIds.has(id))).toBe(true);

    const copiedEndpointIds = new Set([
      ...copied.components.flatMap(({ terminals }) => terminals.map(({ id }) => id)),
      ...copied.junctions.map(({ id }) => id),
    ]);
    for (const wire of copied.wires) {
      expect(copiedEndpointIds.has(wire.start.id)).toBe(true);
      expect(copiedEndpointIds.has(wire.end.id)).toBe(true);
    }
    expect(copied.annotations.every(({ anchor }) => anchor !== null && copiedEndpointIds.has(anchor.id))).toBe(true);
    expect(copied.components.find(({ label }) => label === "R1")!.position).toEqual({ x: 180, y: 50 });
    expect(copied.junctions[0].position).toEqual({ x: 270, y: 50 });

    const pasted = mustExecute(createHistory(document), { type: "Paste", ...copied });
    expect(validateDocument(pasted.present).ok).toBe(true);
    expect(pasted.present.components).toHaveLength(document.components.length + 2);
    expect(pasted.present.wires).toHaveLength(document.wires.length + 2);
  });

  it("rejects a paste payload that would introduce duplicate IDs without mutating history", () => {
    const document = fixture("FIX-01");
    const history = createHistory(document);
    const result = executeCommand(history, {
      type: "Paste",
      components: [cloneDocument(document).components[0]],
      wires: [],
      junctions: [],
      annotations: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code }) => code)).toContain("DUPLICATE_ID");
    expect(history.present).toStrictEqual(document);
  });
});

describe("command previews and wire route stability (EDT-001/002/005/006)", () => {
  function routedSeries(): CircuitDocument {
    const document = cloneDocument(fixture("FIX-02"));
    document.components.push(createComponent("resistor", "R3", { x: 400, y: 200 }));
    // A deliberate return loop from R2 to V1 must survive unrelated manipulation.
    document.wires.find(w => w.id === "W4")!.waypoints = [
      { x: 500, y: 0 }, { x: 500, y: 300 }, { x: 0, y: 300 },
    ];
    return document;
  }

  it("preserves every existing path throughout an unconnected R3 drag, commit, undo and redo", () => {
    const history = deepFreeze(createHistory(routedSeries()));
    const before = JSON.stringify(history);
    const originalPaths = history.present.wires.map(w => wirePoints(history.present, w));
    for (const position of [{ x: 400, y: 200 }, { x: 440, y: 220 }, { x: 700, y: 400 }, { x: 400, y: 200 }]) {
      const preview = previewCommand(history.present, { type: "MoveComponents", positions: { R3: position } });
      expect(preview.ok).toBe(true);
      if (!preview.ok) throw new Error("preview failed");
      expect(preview.document.wires.map(w => wirePoints(preview.document, w))).toEqual(originalPaths);
      expect(preview.document.wires).toEqual(history.present.wires);
    }
    expect(JSON.stringify(history)).toBe(before);
    const committed = mustExecute(history, { type: "MoveComponents", positions: { R3: { x: 700, y: 400 } } });
    expect(committed.present.wires).toEqual(history.present.wires);
    expect(committed.past).toHaveLength(1);
    expect(undo(committed).present).toEqual(history.present);
    expect(redo(undo(committed)).present).toEqual(committed.present);
  });

  it.each([
    ["connected move", { type: "MoveComponents", positions: { R2: { x: 600, y: 200 } } }],
    ["group move", { type: "MoveComponents", positions: { R1: { x: 500, y: 200 }, R2: { x: 700, y: 200 } } }],
    ["rotation", { type: "RotateComponents", ids: ["R2"] }],
    ["placement", { type: "AddComponent", component: createComponent("resistor", "R4", { x: 400, y: 400 }) }],
  ] as const)("shows exactly the committed geometry for %s without changing input", (_name, command) => {
    const history = deepFreeze(createHistory(routedSeries()));
    const before = JSON.stringify(history);
    const preview = previewCommand(history.present, command as Command);
    const committed = mustExecute(history, command as Command);
    expect(preview).toEqual({ ok: true, document: committed.present });
    expect(JSON.stringify(history)).toBe(before);
    expect(undo(committed).present).toEqual(history.present);
    expect(redo(undo(committed)).present).toEqual(committed.present);
  });

  it("reroutes only wires attached to genuinely moved terminals, including mixed selections", () => {
    const document = routedSeries();
    const history = createHistory(document);
    const committed = mustExecute(history, { type: "MoveComponents", positions: {
      R1: { x: 420, y: 100 },
      R2: { ...document.components.find(c => c.id === "R2")!.position },
    } });
    for (const wire of document.wires) {
      const changed = [wire.start.id, wire.end.id].some(id => ["R1.a", "R1.b"].includes(id));
      const actual = committed.present.wires.find(w => w.id === wire.id)!;
      expect(actual.start).toEqual(wire.start); expect(actual.end).toEqual(wire.end);
      if (!changed) expect(actual).toEqual(wire);
      else {
        const path = wirePoints(committed.present, actual);
        expect(path.slice(1).every((p,i) => p.x === path[i].x || p.y === path[i].y)).toBe(true);
      }
    }
    expect(committed.present.wires.find(w => w.id === "W4")!.waypoints).toHaveLength(3);
  });

  it("keeps no-op moves and redo history intact", () => {
    const base = createHistory(routedSeries());
    const history = undo(mustExecute(base, { type: "MoveComponents", positions: { R3: { x: 500, y: 200 } } }));
    const command: Command = { type: "MoveComponents", positions: Object.fromEntries(history.present.components.map(c => [c.id, { ...c.position }])) };
    expect(previewCommand(history.present, command)).toEqual({ ok: true, document: history.present });
    const committed = mustExecute(history, command);
    expect(committed).toBe(history);
    expect(committed.future).toHaveLength(1);
  });

  it.each([
    { type: "MoveComponents", positions: { missing: { x: 10, y: 20 } } },
    { type: "MoveComponents", positions: { R3: { x: NaN, y: 20 } } },
  ] as Command[])("rejects invalid preview and commit identically: %j", command => {
    const history = deepFreeze(createHistory(routedSeries()));
    const before = JSON.stringify(history);
    const preview = previewCommand(history.present, command);
    expect(preview.ok).toBe(false);
    expect(executeCommand(history, command)).toEqual(preview);
    expect(JSON.stringify(history)).toBe(before);
  });

  it("enforces activity policy in preview as well as commit", () => {
    const document = routedSeries();
    document.activity = { allowedCommands: ["SetProperties"], revealSteps: [] };
    const command: Command = { type: "MoveComponents", positions: { R3: { x: 500, y: 200 } } };
    const preview = previewCommand(document, command);
    expect(preview).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: "COMMAND_NOT_ALLOWED" })] });
    expect(executeCommand(createHistory(document), command)).toEqual(preview);
  });
});

describe("value parsing and activity policy", () => {
  it.each([
    ["1k", 1_000],
    ["1 kΩ", 1_000],
    ["1.5 kΩ", 1_500],
    ["1.0 kohm", 1_000],
    ["1000 Ω", 1_000],
    ["1e3 ohm", 1_000],
  ] as const)("normalizes %s to %d ohms", (written, expected) => {
    expect(parseValue(written, "Ω")).toBe(expected);
  });

  it.each(["", "one kΩ", "1 V", "-1 Ω", "Infinity", "1kk", "1 Ω trailing"])(
    "rejects invalid resistance input %s so the previous value can be retained",
    (written) => {
      const document = fixture("FIX-01");
      const history = createHistory(document);
      const parsed = parseValue(written, "Ω");
      expect(parsed).toBeNull();
      expect(history.present.components.find(({ id }) => id === "R1")!.properties.resistanceOhm).toBe(9);
      expect(history.past).toEqual([]);
    },
  );

  it("stores equivalent text inputs as the same SI value", () => {
    const values = ["1k", "1000 Ω"].map((input) => parseValue(input, "Ω"));
    expect(values).toEqual([1_000, 1_000]);

    const histories = values.map((resistanceOhm) =>
      mustExecute(createHistory(fixture("FIX-01")), {
        type: "SetProperties",
        id: "R1",
        properties: { resistanceOhm: resistanceOhm as number },
      }),
    );
    expect(histories[0].present).toStrictEqual(histories[1].present);
  });

  it("blocks a forbidden command before it can mutate the document", () => {
    const document = cloneDocument(fixture("FIX-01"));
    document.activity = { allowedCommands: ["SetProperties"], revealSteps: [] };
    const history = createHistory(document);
    const before = JSON.stringify(history);

    const result = executeCommand(history, {
      type: "DeleteElements",
      ids: ["R1"],
    });

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "COMMAND_NOT_ALLOWED" })],
    });
    expect(JSON.stringify(history)).toBe(before);
  });

  it("allows only commands explicitly listed by the activity", () => {
    const document = cloneDocument(fixture("FIX-01"));
    document.activity = { allowedCommands: ["SetProperties"], revealSteps: [] };
    const history = mustExecute(createHistory(document), {
      type: "SetProperties",
      id: "R1",
      properties: { resistanceOhm: 12 },
    });
    expect(history.present.components.find(({ id }) => id === "R1")!.properties.resistanceOhm).toBe(12);
  });
});

describe("versioned JSON persistence", () => {
  it("serializes and parses a migrated document without changing its meaning", () => {
    const document = fixture("FIX-03");
    const serialized = serializeDocument(document);
    const parsed = parseDocument(serialized);

    expect(parsed).toEqual({ ok: true, document });
    expect(JSON.parse(serialized)).toStrictEqual(document);
  });

  it.each([
    ["malformed JSON", "{", "INVALID_JSON"],
    ["future version", JSON.stringify({ ...fixture("FIX-01"), version: 5 }), "INVALID_DOCUMENT"],
    [
      "dangling semantic reference",
      JSON.stringify({
        ...fixture("FIX-01"),
        wires: [
          {
            id: "W-missing",
            start: { kind: "terminal", id: "R1.a" },
            end: { kind: "terminal", id: "missing" },
            waypoints: [],
          },
        ],
      }),
      "INVALID_REFERENCE",
    ],
  ] as const)("rejects %s with a structured diagnostic", (_name, text, expectedCode) => {
    const result = parseDocument(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code }) => code)).toContain(expectedCode);
  });

  it.each([
    ["future version", { ...fixture("FIX-02"), version: 5 }],
    [
      "dangling reference",
      {
        ...fixture("FIX-02"),
        referenceNode: { kind: "terminal", id: "missing" },
      },
    ],
  ] as const)("does not replace the current document with a %s document", (_name, replacement) => {
    const history = createHistory(fixture("FIX-01"));
    const before = JSON.stringify(history);
    const result = executeCommand(history, {
      type: "ReplaceDocument",
      document: replacement as unknown as CircuitDocument,
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(history)).toBe(before);
  });

  it("does not write anything when asked to save an invalid document", () => {
    const storage = new MemoryStorage();
    const invalid = { ...fixture("FIX-01"), version: 5 } as unknown as CircuitDocument;

    const result = saveLocal(invalid, "auto", storage);
    expect(result.ok).toBe(false);
    expect(storage.writes).toEqual([]);
    expect(storage.values.size).toBe(0);
  });

  it("keeps automatic and manual saves under separate versioned keys", () => {
    const storage = new MemoryStorage();
    const automatic = fixture("FIX-01");
    const manual = fixture("FIX-02");

    expect(saveLocal(automatic, "auto", storage)).toEqual({ ok: true });
    expect(saveLocal(manual, "manual", storage)).toEqual({ ok: true });
    expect(loadLocal("auto", storage)).toEqual({ ok: true, document: automatic });
    expect(loadLocal("manual", storage)).toEqual({ ok: true, document: manual });
    expect([...storage.values.keys()].sort()).toEqual([
      "edu-circuit:auto:v1",
      "edu-circuit:manual:v1",
    ]);
  });

  it("recovers the last valid automatic backup when the primary value is corrupt", () => {
    const storage = new MemoryStorage();
    const first = fixture("FIX-01");
    const second = fixture("FIX-02");
    expect(saveLocal(first, "auto", storage)).toEqual({ ok: true });
    expect(saveLocal(second, "auto", storage)).toEqual({ ok: true });
    storage.values.set("edu-circuit:auto:v1", "corrupt JSON");

    expect(loadLocal("auto", storage)).toEqual({ ok: true, document: first });
    expect(loadLocal("manual", storage)).toBeNull();
  });

  it("does not replace a valid stored document when quota failure prevents a write", () => {
    const storage = new MemoryStorage();
    const first = fixture("FIX-01");
    expect(saveLocal(first, "auto", storage)).toEqual({ ok: true });
    const original = storage.values.get("edu-circuit:auto:v1");
    storage.setFailure = new DOMException("Quota exceeded", "QuotaExceededError");

    const result = saveLocal(fixture("FIX-02"), "auto", storage);
    expect(result.ok).toBe(false);
    expect(storage.values.get("edu-circuit:auto:v1")).toBe(original);
    expect(loadLocal("auto", Object.assign(storage, { setFailure: null }))).toEqual({
      ok: true,
      document: first,
    });
  });

  it("returns a structured storage diagnostic when reading fails", () => {
    const storage = new MemoryStorage();
    storage.getFailure = new Error("storage disabled");

    const result = loadLocal("auto", storage);
    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "STORAGE_READ_FAILED" })],
    });
  });
});
