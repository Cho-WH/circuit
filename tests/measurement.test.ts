import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createComponent } from "../src/component-library";
import { circuitCompiler, compileCircuit } from "../src/connectivity";
import type {
  CircuitDocument,
  CompiledCircuit,
  CompiledElement,
  SimulationResult,
} from "../src/domain";
import {
  checkKcl,
  checkKvl,
  equivalentResistance,
  solveCircuit,
} from "../src/simulation";
import {
  createMeasurementRecord,
  insertSeriesAmmeter,
  measurementsToCsv,
  parameterSweep,
  probeVoltage,
  type MeasurementRecord,
} from "../src/measurement";
import { dcEngine } from "../src/simulation";
import { suggestPaths } from "../src/visualization";

const root = resolve(process.cwd());

interface FixtureFile {
  id: string;
  document: CircuitDocument;
  expected: {
    equivalentResistance?: {
      port: { first: { id: string }; second: { id: string } };
      ohm: number;
    };
  };
}

function fixture(filename: string): FixtureFile {
  return JSON.parse(readFileSync(join(root, "fixtures", filename), "utf8")) as FixtureFile;
}

function compiledFixture(filename: string) {
  const source = fixture(filename);
  const compilation = compileCircuit(source.document);
  expect(compilation.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  return { ...source, circuit: compilation.circuit, result: solveCircuit(compilation.circuit) };
}

function net(id: string) {
  return { id, endpointIds: [], wireIds: [] };
}

function element(
  id: string,
  type: CompiledElement["type"],
  a: string,
  b: string,
  value: number,
  closed = false,
): CompiledElement {
  return { id, type, a, b, value, closed };
}

describe("equivalent resistance", () => {
  it.each([
    "FIX-01-single-resistor.json",
    "FIX-02-series.json",
    "FIX-03-parallel.json",
    "FIX-04-series-parallel.json",
    "FIX-09-balanced-bridge.json",
    "FIX-10-reference-shift.json",
  ])("matches the fixture load resistance when the port source is removed: %s", (filename) => {
    const { circuit, expected } = compiledFixture(filename);
    const resistance = expected.equivalentResistance!;
    const a = circuit.endpointToNet[resistance.port.first.id];
    const b = circuit.endpointToNet[resistance.port.second.id];
    const before = JSON.stringify(circuit);

    const result = equivalentResistance(circuit, a, b, { excludeSourceIds: ["V1"] });

    expect(result.status).toBe("finite");
    expect(result.ohms).toBeCloseTo(resistance.ohm, 9);
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(circuit)).toBe(before);
  });

  it.each([
    "FIX-01-single-resistor.json",
    "FIX-02-series.json",
    "FIX-03-parallel.json",
    "FIX-04-series-parallel.json",
    "FIX-09-balanced-bridge.json",
    "FIX-10-reference-shift.json",
  ])("deactivates every retained independent source to a 0 V short: %s", (filename) => {
    const { circuit, expected } = compiledFixture(filename);
    const resistance = expected.equivalentResistance!;
    const a = circuit.endpointToNet[resistance.port.first.id];
    const b = circuit.endpointToNet[resistance.port.second.id];

    const result = equivalentResistance(circuit, a, b);

    expect(result.status).toBe("short");
    expect(result.ohms).toBe(0);
    expect(result.diagnostics.map(({ code }) => code)).toContain("RESISTANCE_SHORT");
  });

  it("deactivates an internal independent source without removing its connection", () => {
    const circuit: CompiledCircuit = {
      nets: ["port-a", "inner-left", "inner-right", "port-b"].map(net),
      endpointToNet: {},
      referenceNetId: "port-b",
      elements: [
        element("R1", "resistor", "port-a", "inner-left", 2),
        element("Vinternal", "dc-voltage-source", "inner-left", "inner-right", 25),
        element("R2", "resistor", "inner-right", "port-b", 3),
      ],
    };

    const result = equivalentResistance(circuit, "port-a", "port-b");

    expect(result.status).toBe("finite");
    expect(result.ohms).toBeCloseTo(5, 12);
    expect(result.diagnostics).toEqual([]);
  });

  it("distinguishes open, short, and invalid ports without inventing finite values", () => {
    const openCircuit: CompiledCircuit = {
      nets: [net("a"), net("b")],
      elements: [],
      endpointToNet: {},
      referenceNetId: "b",
    };
    const shortCircuit: CompiledCircuit = {
      ...openCircuit,
      elements: [element("R0", "resistor", "a", "b", 0)],
    };

    const open = equivalentResistance(openCircuit, "a", "b");
    expect(open.status).toBe("open");
    expect(open.ohms).toBeUndefined();
    expect(open.diagnostics.map(({ code }) => code)).toEqual(["RESISTANCE_OPEN"]);

    const short = equivalentResistance(shortCircuit, "a", "b");
    expect(short.status).toBe("short");
    expect(short.ohms).toBe(0);
    expect(short.diagnostics.map(({ code }) => code)).toEqual(["RESISTANCE_SHORT"]);

    const invalid = equivalentResistance(openCircuit, "missing", "b");
    expect(invalid.status).toBe("error");
    expect(invalid.ohms).toBeUndefined();
    expect(invalid.diagnostics.map(({ code }) => code)).toEqual(["INVALID_RESISTANCE_PORT"]);
  });

  it("rejects invalid exclusion IDs and invalid retained elements", () => {
    const { circuit } = compiledFixture("FIX-01-single-resistor.json");
    const a = circuit.endpointToNet["V1.p"];
    const b = circuit.endpointToNet["V1.n"];
    expect(equivalentResistance(circuit, a, b, { excludeSourceIds: ["R1"] }).status).toBe("error");

    const invalid: CompiledCircuit = {
      ...circuit,
      elements: circuit.elements.map((entry) =>
        entry.id === "R1" ? { ...entry, value: Number.NaN } : entry,
      ),
    };
    const result = equivalentResistance(invalid, a, b, { excludeSourceIds: ["V1"] });
    expect(result.status).toBe("error");
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["INVALID_COMPONENT_VALUE"]);
  });
});

describe("KCL and KVL checks", () => {
  it.each([
    "FIX-02-series.json",
    "FIX-03-parallel.json",
    "FIX-04-series-parallel.json",
    "FIX-09-balanced-bridge.json",
  ])("passes KCL at every solved net with signed element terms: %s", (filename) => {
    const { circuit, result } = compiledFixture(filename);
    expect(result.status).toBe("solved");

    for (const circuitNet of circuit.nets) {
      const check = checkKcl(circuit, result, circuitNet.id);
      expect(check.defined).toBe(true);
      expect(check.passes).toBe(true);
      expect(check.sum).toBeCloseTo(0, 9);
      expect(check.terms.length).toBeGreaterThan(0);
      expect(check.diagnostics).toEqual([]);
      expect(Math.abs(check.sum!)).toBeLessThanOrEqual(check.tolerance);
    }
  });

  it.each([
    "FIX-02-series.json",
    "FIX-03-parallel.json",
    "FIX-04-series-parallel.json",
    "FIX-09-balanced-bridge.json",
  ])("passes KVL for every suggested closed path: %s", (filename) => {
    const { circuit, result } = compiledFixture(filename);
    const paths = suggestPaths(circuit);
    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      const check = checkKvl(circuit, result, path.steps);
      expect(check.defined).toBe(true);
      expect(check.passes).toBe(true);
      expect(check.sum).toBeCloseTo(0, 9);
      expect(check.terms.map(({ elementId }) => elementId)).toEqual(
        path.steps.map(({ elementId }) => elementId),
      );
      expect(check.diagnostics).toEqual([]);
    }
  });

  it("rejects an electrically open switch path even when its net sequence is geometrically closed", () => {
    const { circuit, result } = compiledFixture("FIX-05-open-switch.json");
    const path = suggestPaths(circuit)[0];
    expect(path.steps.map(({ elementId }) => elementId)).toEqual(["V1", "S1", "R1"]);

    const check = checkKvl(circuit, result, path.steps);

    expect(check.defined).toBe(false);
    expect(check.passes).toBe(false);
    expect(check.sum).toBeUndefined();
    expect(check.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects missing nets, failed solutions, discontinuous paths, and missing elements", () => {
    const { circuit, result } = compiledFixture("FIX-02-series.json");
    const failed: SimulationResult = {
      status: "error",
      nodeVoltages: {},
      branchCurrents: {},
      componentVoltages: {},
      componentPowers: {},
      diagnostics: [],
    };

    expect(checkKcl(circuit, result, "missing").diagnostics[0].code).toBe("INVALID_REFERENCE");
    expect(checkKcl(circuit, failed, circuit.nets[0].id).diagnostics[0].code).toBe(
      "MEASUREMENT_UNAVAILABLE",
    );
    expect(checkKvl(circuit, result, []).diagnostics[0].code).toBe("PATH_NOT_CLOSED");

    const suggested = suggestPaths(circuit)[0].steps;
    const discontinuous = suggested.map((step) => ({ ...step }));
    discontinuous[1].from = "not-the-previous-net";
    expect(checkKvl(circuit, result, discontinuous).diagnostics[0].code).toBe("PATH_NOT_CLOSED");

    const missingElement = suggested.map((step) => ({ ...step }));
    missingElement[0].elementId = "missing";
    expect(checkKvl(circuit, result, missingElement).diagnostics[0].code).toBe("INVALID_PATH");
    expect(checkKvl(circuit, failed, suggested).diagnostics[0].code).toBe(
      "MEASUREMENT_UNAVAILABLE",
    );
  });

  it("reports a conservation residual and preserves both circuit and result inputs", () => {
    const { circuit, result } = compiledFixture("FIX-03-parallel.json");
    const altered: SimulationResult = {
      ...result,
      branchCurrents: { ...result.branchCurrents, R1: result.branchCurrents.R1 + 0.5 },
    };
    const circuitBefore = JSON.stringify(circuit);
    const resultBefore = JSON.stringify(altered);
    const junctionNet = circuit.endpointToNet.JT;

    const check = checkKcl(circuit, altered, junctionNet);

    expect(check.defined).toBe(true);
    expect(check.passes).toBe(false);
    expect(check.sum).toBeCloseTo(0.5, 12);
    expect(check.diagnostics.map(({ code }) => code)).toEqual(["CONSERVATION_RESIDUAL"]);
    expect(JSON.stringify(circuit)).toBe(circuitBefore);
    expect(JSON.stringify(altered)).toBe(resultBefore);
  });
});

describe("voltage probes", () => {
  it("uses red minus black and reverses sign without changing magnitude", () => {
    const { circuit, result } = compiledFixture("FIX-02-series.json");
    const compilation = { circuit, diagnostics: [] };
    const forward = probeVoltage(
      compilation,
      result,
      { kind: "terminal", id: "V1.p" },
      { kind: "junction", id: "J1" },
    );
    const reverse = probeVoltage(
      compilation,
      result,
      { kind: "junction", id: "J1" },
      { kind: "terminal", id: "V1.p" },
    );

    expect(forward.ok).toBe(true);
    expect(reverse.ok).toBe(true);
    if (!forward.ok || !reverse.ok) return;
    expect(forward.value.voltageV).toBeCloseTo(3, 12);
    expect(reverse.value.voltageV).toBeCloseTo(-3, 12);
    expect(forward.value.voltageV).toBeCloseTo(-reverse.value.voltageV, 12);
  });

  it("returns exactly zero for two probes on the same net", () => {
    const { circuit, result } = compiledFixture("FIX-03-parallel.json");
    const measured = probeVoltage(
      { circuit, diagnostics: [] },
      result,
      { kind: "junction", id: "JT" },
      { kind: "terminal", id: "R2.a" },
    );

    expect(measured.ok).toBe(true);
    if (measured.ok) {
      expect(measured.value.voltageV).toBe(0);
      expect(measured.value.redNetId).toBe(measured.value.blackNetId);
    }
  });

  it("measures the open-switch voltage and remains reference-shift invariant", () => {
    const openSwitch = compiledFixture("FIX-05-open-switch.json");
    const switchVoltage = probeVoltage(
      { circuit: openSwitch.circuit, diagnostics: [] },
      openSwitch.result,
      { kind: "terminal", id: "S1.a" },
      { kind: "terminal", id: "S1.b" },
    );
    expect(switchVoltage.ok && switchVoltage.value.voltageV).toBeCloseTo(9, 12);

    const ordinary = compiledFixture("FIX-02-series.json");
    const shifted = compiledFixture("FIX-10-reference-shift.json");
    const endpoints = [
      { kind: "terminal", id: "V1.p" },
      { kind: "terminal", id: "V1.n" },
    ] as const;
    const first = probeVoltage(
      { circuit: ordinary.circuit, diagnostics: [] },
      ordinary.result,
      endpoints[0],
      endpoints[1],
    );
    const second = probeVoltage(
      { circuit: shifted.circuit, diagnostics: [] },
      shifted.result,
      endpoints[0],
      endpoints[1],
    );
    expect(first.ok && first.value.voltageV).toBeCloseTo(9, 12);
    expect(second.ok && second.value.voltageV).toBeCloseTo(9, 12);
  });

  it("withholds numbers for incomplete, invalid, and floating probes", () => {
    const solved = compiledFixture("FIX-02-series.json");
    expect(
      probeVoltage(
        { circuit: solved.circuit, diagnostics: [] },
        solved.result,
        { kind: "terminal", id: "V1.p" },
        null,
      ),
    ).toEqual(expect.objectContaining({ ok: false }));
    expect(
      probeVoltage(
        { circuit: solved.circuit, diagnostics: [] },
        solved.result,
        { kind: "terminal", id: "missing" },
        { kind: "terminal", id: "V1.n" },
      ),
    ).toEqual(expect.objectContaining({ ok: false }));

    const floating = compiledFixture("FIX-07-floating-network.json");
    const unavailable = probeVoltage(
      { circuit: floating.circuit, diagnostics: [] },
      floating.result,
      { kind: "terminal", id: "R1.a" },
      { kind: "terminal", id: "R1.b" },
    );
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("temporary series ammeter insertion", () => {
  it("inserts an ideal meter in series without changing the original circuit", () => {
    const original = fixture("FIX-01-single-resistor.json").document;
    const before = JSON.stringify(original);
    const ammeter = createComponent("ammeter", "A1", { x: 80, y: 0 });
    const inserted = insertSeriesAmmeter(original, {
      componentId: "R1",
      ammeter,
      newWireId: "WA1",
    });

    expect(inserted.ok).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
    if (!inserted.ok) return;
    expect(inserted.value.terminalId).toBe("R1.a");
    expect(inserted.value.rewiredWireIds).toEqual(["W1"]);
    expect(inserted.value.positiveDirection).toEqual({
      from: { kind: "terminal", id: "A1.a" },
      to: { kind: "terminal", id: "A1.b" },
    });

    const compiled = compileCircuit(inserted.value.document);
    const result = solveCircuit(compiled.circuit);
    expect(result.status).toBe("solved");
    expect(result.branchCurrents.A1).toBeCloseTo(1, 12);
    expect(result.branchCurrents.R1).toBeCloseTo(1, 12);
    inserted.value.document.components.find(({ id }) => id === "A1")!.label = "changed";
    expect(ammeter.label).toBe("A1");
  });

  it("uses a source's positive terminal even when its imported terminal order is reversed", () => {
    const original = fixture("FIX-01-single-resistor.json").document;
    original.components.find(({ id }) => id === "V1")!.terminals.reverse();
    const inserted = insertSeriesAmmeter(original, {
      componentId: "V1",
      ammeter: createComponent("ammeter", "A1", { x: -80, y: 0 }),
      newWireId: "WA1",
    });

    expect(inserted.ok).toBe(true);
    if (inserted.ok) expect(inserted.value.terminalId).toBe("V1.p");
  });

  it("measures total parallel current while preserving branch currents", () => {
    const original = fixture("FIX-03-parallel.json").document;
    const inserted = insertSeriesAmmeter(original, {
      componentId: "V1",
      ammeter: createComponent("ammeter", "A1", { x: 60, y: 0 }),
      newWireId: "WA1",
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    const compiled = compileCircuit(inserted.value.document);
    const result = solveCircuit(compiled.circuit);
    expect(result.status).toBe("solved");
    expect(Math.abs(result.branchCurrents.A1)).toBeCloseTo(3, 12);
    expect(result.branchCurrents.R1).toBeCloseTo(1, 12);
    expect(result.branchCurrents.R2).toBeCloseTo(2, 12);
  });

  it("rejects missing targets, unconnected insertion points, non-meters, and duplicate IDs", () => {
    const original = fixture("FIX-01-single-resistor.json").document;
    const meter = createComponent("ammeter", "A1", { x: 80, y: 0 });
    expect(
      insertSeriesAmmeter(original, { componentId: "missing", ammeter: meter, newWireId: "WA1" }),
    ).toEqual(expect.objectContaining({ ok: false }));

    const unconnected = structuredClone(original);
    unconnected.wires = unconnected.wires.filter(({ id }) => id !== "W1");
    expect(
      insertSeriesAmmeter(unconnected, { componentId: "R1", ammeter: meter, newWireId: "WA1" }),
    ).toEqual(expect.objectContaining({ ok: false }));

    expect(
      insertSeriesAmmeter(original, {
        componentId: "R1",
        ammeter: createComponent("resistor", "R3", { x: 80, y: 0 }),
        newWireId: "WA1",
      }),
    ).toEqual(expect.objectContaining({ ok: false }));

    expect(
      insertSeriesAmmeter(original, {
        componentId: "R1",
        ammeter: createComponent("ammeter", "V1", { x: 80, y: 0 }),
        newWireId: "W2",
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
  });
});

describe("parameter sweeps", () => {
  it("preserves raw axes and Ohm-law samples while leaving failed physics samples unconnected", () => {
    const original = fixture("FIX-01-single-resistor.json").document;
    const before = JSON.stringify(original);
    const swept = parameterSweep(
      original,
      {
        componentId: "R1",
        property: "resistanceOhm",
        values: [9, 18, 0],
        xLabel: "저항",
        xUnit: "Ω",
        yLabel: "전류",
        quantity: { kind: "branch-current", componentId: "R1" },
      },
      circuitCompiler,
      dcEngine,
    );

    expect(swept.ok).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
    if (!swept.ok) return;
    expect(swept.value).toEqual(
      expect.objectContaining({ xLabel: "저항", xUnit: "Ω", yLabel: "전류", yUnit: "A" }),
    );
    expect(swept.value.samples[0]).toEqual({ x: 9, y: 1, diagnostics: [] });
    expect(swept.value.samples[1].x).toBe(18);
    expect(swept.value.samples[1].y).toBeCloseTo(0.5, 12);
    expect(swept.value.samples[2].x).toBe(0);
    expect(swept.value.samples[2].y).toBeNull();
    expect(swept.value.samples[2].diagnostics[0].parameters).toEqual(
      expect.objectContaining({ sampleIndex: 2, x: 0 }),
    );
  });

  it("supports probe-voltage and power quantities with their physical units", () => {
    const document = fixture("FIX-01-single-resistor.json").document;
    const probe = parameterSweep(
      document,
      {
        componentId: "R1",
        property: "resistanceOhm",
        values: [9, 18],
        xLabel: "R",
        xUnit: "Ω",
        yLabel: "V",
        quantity: {
          kind: "probe-voltage",
          red: { kind: "terminal", id: "R1.a" },
          black: { kind: "terminal", id: "R1.b" },
        },
      },
      circuitCompiler,
      dcEngine,
    );
    expect(probe.ok && probe.value.yUnit).toBe("V");
    if (probe.ok) expect(probe.value.samples.map(({ y }) => y)).toEqual([9, 9]);

    const power = parameterSweep(
      document,
      {
        componentId: "R1",
        property: "resistanceOhm",
        values: [9, 18],
        xLabel: "R",
        xUnit: "Ω",
        yLabel: "P",
        quantity: { kind: "component-power", componentId: "R1" },
      },
      circuitCompiler,
      dcEngine,
    );
    expect(power.ok && power.value.yUnit).toBe("W");
    if (power.ok) expect(power.value.samples.map(({ y }) => y)).toEqual([9, 4.5]);
  });

  it("rejects unsafe sample counts, values, axes, units, targets, and property mismatches", () => {
    const document = fixture("FIX-01-single-resistor.json").document;
    const base = {
      componentId: "R1",
      property: "resistanceOhm" as const,
      values: [9],
      xLabel: "R",
      xUnit: "Ω" as const,
      yLabel: "I",
      quantity: { kind: "branch-current" as const, componentId: "R1" },
    };
    const invalidRequests = [
      { ...base, values: [] },
      { ...base, values: Array.from({ length: 101 }, (_, index) => index + 1) },
      { ...base, values: [-1] },
      { ...base, values: [Number.NaN] },
      { ...base, xLabel: " " },
      { ...base, xUnit: "V" as const },
      { ...base, componentId: "missing" },
      { ...base, property: "voltageV" as const, xUnit: "V" as const },
    ];
    for (const request of invalidRequests) {
      expect(parameterSweep(document, request, circuitCompiler, dcEngine).ok).toBe(false);
    }
  });
});

describe("measurement records and CSV", () => {
  it("freezes document state, raw values, conditions, and caller-provided times", () => {
    const document = fixture("FIX-01-single-resistor.json").document;
    const first = createMeasurementRecord(document, {
      condition: "R=9 Ω",
      source: "simulation",
      quantity: "current",
      value: 1,
      unit: "A",
      targetIds: ["R1"],
      recordedAt: "2026-09-23T00:00:00.000Z",
    });
    document.components.find(({ id }) => id === "R1")!.properties.resistanceOhm = 18;
    const second = createMeasurementRecord(document, {
      condition: "R=18 Ω",
      source: "simulation",
      quantity: "current",
      value: 0.5,
      unit: "A",
      targetIds: ["R1"],
      recordedAt: "2026-09-23T00:01:00.000Z",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.documentSnapshot.components[1].properties.resistanceOhm).toBe(9);
    expect(second.value.documentSnapshot.components[1].properties.resistanceOhm).toBe(18);
    expect(first.value.recordedAt).toBe("2026-09-23T00:00:00.000Z");
    expect(second.value.value).toBe(0.5);
  });

  it("rejects inconsistent units, nonfinite values, and invalid snapshots", () => {
    const document = fixture("FIX-01-single-resistor.json").document;
    expect(
      createMeasurementRecord(document, {
        condition: "bad unit",
        source: "simulation",
        quantity: "current",
        value: 1,
        unit: "V",
        targetIds: ["R1"],
      }).ok,
    ).toBe(false);
    expect(
      createMeasurementRecord(document, {
        condition: "bad value",
        source: "external",
        quantity: "voltage",
        value: Number.POSITIVE_INFINITY,
        unit: "V",
        targetIds: ["probe"],
      }).ok,
    ).toBe(false);
  });

  it("exports RFC-quoted English CSV fields and prevents spreadsheet formulas", () => {
    const document = fixture("FIX-01-single-resistor.json").document;
    const created = createMeasurementRecord(document, {
      condition: '=HYPERLINK("https://example.invalid"),\nstudent',
      source: "external",
      quantity: "voltage",
      value: -0.25,
      unit: "V",
      targetIds: ["@probe", "V1.p"],
      recordedAt: "2026-09-23T00:02:00.000Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const exported = measurementsToCsv([created.value]);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const [header, ...bodyLines] = exported.value.split("\r\n");
    expect(header).toBe(
      "condition,documentId,source,quantity,value,unit,targetIds,recordedAt,documentSnapshot",
    );
    const body = bodyLines.join("\r\n");
    expect(body).toContain('"\'=HYPERLINK(""https://example.invalid""),');
    expect(body).toContain("'@probe|V1.p");
    expect(body).toContain(",external,voltage,-0.25,V,");
    expect(body).toContain('"{""format"":""edu-circuit""');
  });

  it("rejects a record whose saved document no longer validates", () => {
    const document = fixture("FIX-01-single-resistor.json").document;
    const created = createMeasurementRecord(document, {
      condition: "valid",
      source: "simulation",
      quantity: "resistance",
      value: 9,
      unit: "Ω",
      targetIds: ["R1"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const corrupted = structuredClone(created.value) as MeasurementRecord;
    corrupted.documentSnapshot.wires[0].start.id = "missing";
    expect(measurementsToCsv([corrupted]).ok).toBe(false);
  });
});
