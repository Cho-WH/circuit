import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CircuitDocument,
  type CompiledCircuit,
  type ComponentInstance,
  type Diagnostic,
  type SimulationResult,
} from "../src/domain";
import { compileCircuit } from "../src/connectivity";
import { solveCircuit } from "../src/simulation";

type Tolerance = {
  absolute: number;
  relative: number;
};

type FixtureExpected = {
  status: "solved" | "warning" | "error";
  tolerance: Tolerance;
  probeVoltagesV: Record<string, number>;
  branchCurrentsA: Record<string, number>;
  componentVoltagesV: Record<string, number>;
  componentPowersW: Record<string, number>;
  diagnostics: string[];
  numericalResultsForbidden?: boolean;
};

type CircuitFixture = {
  id: string;
  document: CircuitDocument;
  expected: FixtureExpected;
};

type CircuitRun = {
  circuit: CompiledCircuit;
  result: SimulationResult;
};

const root = resolve(process.cwd());
const fixtures = readdirSync(join(root, "fixtures"))
  .filter((name) => /^FIX-[0-9]{2}-.+\.json$/.test(name))
  .sort()
  .map(
    (name) =>
      JSON.parse(readFileSync(join(root, "fixtures", name), "utf8")) as CircuitFixture,
  );
const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

function emptyResult(diagnostics: Diagnostic[]): SimulationResult {
  return {
    status: diagnostics.some(({ severity }) => severity === "error") ? "error" : "warning",
    nodeVoltages: {},
    branchCurrents: {},
    componentVoltages: {},
    componentPowers: {},
    diagnostics,
  };
}

function runDocument(document: CircuitDocument): CircuitRun {
  const compilation = compileCircuit(document);
  const hasCompileError = compilation.diagnostics.some(({ severity }) => severity === "error");
  if (hasCompileError) {
    return { circuit: compilation.circuit, result: emptyResult(compilation.diagnostics) };
  }

  const solved = solveCircuit(compilation.circuit);
  const diagnostics = [...compilation.diagnostics, ...solved.diagnostics];
  return {
    circuit: compilation.circuit,
    result: {
      ...solved,
      status:
        solved.status === "error"
          ? "error"
          : diagnostics.some(({ severity }) => severity === "warning")
            ? "warning"
            : solved.status,
      diagnostics,
    },
  };
}

function expectClose(actual: number | undefined, expected: number, tolerance: Tolerance): void {
  expect(actual, "expected a finite numeric result").toBeTypeOf("number");
  expect(Number.isFinite(actual)).toBe(true);
  const allowedError = tolerance.absolute + tolerance.relative * Math.abs(expected);
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(allowedError);
}

function expectResultMap(
  actual: Record<string, number>,
  expected: Record<string, number>,
  tolerance: Tolerance,
): void {
  for (const [id, value] of Object.entries(expected)) {
    expectClose(actual[id], value, tolerance);
  }
}

function expectNoNumericalResults(result: SimulationResult): void {
  expect(result.nodeVoltages).toEqual({});
  expect(result.branchCurrents).toEqual({});
  expect(result.componentVoltages).toEqual({});
  expect(result.componentPowers).toEqual({});
}

function component(
  id: string,
  type: ComponentInstance["type"],
  properties: ComponentInstance["properties"],
  y = 0,
): ComponentInstance {
  return {
    id,
    type,
    label: id,
    position: { x: 0, y },
    rotation: 0,
    properties,
    terminals: [
      { id: `${id}.a`, role: type === "dc-voltage-source" ? "positive" : "a" },
      { id: `${id}.b`, role: type === "dc-voltage-source" ? "negative" : "b" },
    ],
  };
}

function seriesDocument(
  middle: ComponentInstance,
  resistanceOhm = 9,
): CircuitDocument {
  return {
    format: "edu-circuit",
    version: 4,
    documentId: `series-${middle.id}`,
    title: `직렬 ${middle.id}`,
    components: [
      component("V1", "dc-voltage-source", { voltageV: 9 }),
      middle,
      component("R1", "resistor", { resistanceOhm }),
    ],
    wires: [
      {
        id: "W1",
        start: { kind: "terminal", id: "V1.a" },
        end: { kind: "terminal", id: `${middle.id}.a` },
        waypoints: [],
      },
      {
        id: "W2",
        start: { kind: "terminal", id: `${middle.id}.b` },
        end: { kind: "terminal", id: "R1.a" },
        waypoints: [],
      },
      {
        id: "W3",
        start: { kind: "terminal", id: "R1.b" },
        end: { kind: "terminal", id: "V1.b" },
        waypoints: [],
      },
    ],
    junctions: [],
    annotations: [],
    referenceNode: { kind: "terminal", id: "V1.b" },
    activity: null,
  };
}

function parallelDocument(second: ComponentInstance, sourceVoltage = 9): CircuitDocument {
  return {
    format: "edu-circuit",
    version: 4,
    documentId: `parallel-${second.id}`,
    title: `병렬 ${second.id}`,
    components: [
      component("V1", "dc-voltage-source", { voltageV: sourceVoltage }),
      second,
    ],
    wires: [
      {
        id: "W1",
        start: { kind: "terminal", id: "V1.a" },
        end: { kind: "terminal", id: `${second.id}.a` },
        waypoints: [],
      },
      {
        id: "W2",
        start: { kind: "terminal", id: "V1.b" },
        end: { kind: "terminal", id: `${second.id}.b` },
        waypoints: [],
      },
    ],
    junctions: [],
    annotations: [],
    referenceNode: { kind: "terminal", id: "V1.b" },
    activity: null,
  };
}

describe("FIX-01 through FIX-10", () => {
  it.each(fixtures)("matches $id status, diagnostics, and expected values", (fixture) => {
    const { circuit, result } = runDocument(fixture.document);
    const expected = fixture.expected;

    expect(result.status).toBe(expected.status);
    expect([...new Set(result.diagnostics.map(({ code }) => code))].sort()).toEqual(
      [...expected.diagnostics].sort(),
    );

    if (expected.numericalResultsForbidden === true) {
      expectNoNumericalResults(result);
      return;
    }

    for (const [endpointId, expectedVoltage] of Object.entries(expected.probeVoltagesV)) {
      const netId = circuit.endpointToNet[endpointId];
      expect(netId, `missing net for endpoint ${endpointId}`).toBeTypeOf("string");
      expectClose(result.nodeVoltages[netId], expectedVoltage, expected.tolerance);
    }
    expectResultMap(result.branchCurrents, expected.branchCurrentsA, expected.tolerance);
    expectResultMap(result.componentVoltages, expected.componentVoltagesV, expected.tolerance);
    expectResultMap(result.componentPowers, expected.componentPowersW, expected.tolerance);
  });

  it.each(fixtures.filter(({ expected }) => expected.status === "solved"))(
    "$id satisfies KCL and total power conservation without rounded display values",
    (fixture) => {
      const { circuit, result } = runDocument(fixture.document);
      expect(result.status).toBe("solved");

      const netCurrent = new Map(circuit.nets.map(({ id }) => [id, 0]));
      for (const element of circuit.elements) {
        const current = result.branchCurrents[element.id];
        if (current === undefined) continue;
        netCurrent.set(element.a, (netCurrent.get(element.a) ?? 0) + current);
        netCurrent.set(element.b, (netCurrent.get(element.b) ?? 0) - current);
      }
      for (const [netId, sum] of netCurrent) {
        expectClose(sum, 0, fixture.expected.tolerance);
        expect(Number.isFinite(result.nodeVoltages[netId])).toBe(true);
      }

      const totalPower = Object.values(result.componentPowers).reduce(
        (sum, power) => sum + power,
        0,
      );
      expectClose(totalPower, 0, fixture.expected.tolerance);
    },
  );
});

describe("determinism and reference choice", () => {
  it("returns byte-for-byte equivalent compilation and results on repeated input", () => {
    const document = fixturesById.get("FIX-04")!.document;
    expect(runDocument(document)).toStrictEqual(runDocument(document));
  });

  it("is independent of component, wire, and junction array order", () => {
    const source = fixturesById.get("FIX-09")!.document;
    const reordered: CircuitDocument = {
      ...source,
      components: [...source.components].reverse(),
      wires: [...source.wires].reverse(),
      junctions: [...source.junctions].reverse(),
      annotations: [...source.annotations].reverse(),
    };

    expect(runDocument(reordered)).toStrictEqual(runDocument(source));
  });

  it("shifts only absolute node potentials between FIX-02 and FIX-10", () => {
    const base = fixturesById.get("FIX-02")!;
    const shifted = fixturesById.get("FIX-10")!;
    const baseRun = runDocument(base.document);
    const shiftedRun = runDocument(shifted.document);

    expectResultMap(
      shiftedRun.result.branchCurrents,
      baseRun.result.branchCurrents,
      shifted.expected.tolerance,
    );
    expectResultMap(
      shiftedRun.result.componentVoltages,
      baseRun.result.componentVoltages,
      shifted.expected.tolerance,
    );
    expectResultMap(
      shiftedRun.result.componentPowers,
      baseRun.result.componentPowers,
      shifted.expected.tolerance,
    );

    for (const endpointId of Object.keys(base.expected.probeVoltagesV)) {
      const baseNet = baseRun.circuit.endpointToNet[endpointId];
      const shiftedNet = shiftedRun.circuit.endpointToNet[endpointId];
      expectClose(
        baseRun.result.nodeVoltages[baseNet] - shiftedRun.result.nodeVoltages[shiftedNet],
        6,
        shifted.expected.tolerance,
      );
    }
  });

  it("preserves source polarity and passive-sign power for a negative source value", () => {
    const document = seriesDocument(
      component("R0", "resistor", { resistanceOhm: 0 }),
      9,
    );
    document.components.find(({ id }) => id === "V1")!.properties.voltageV = -9;
    const { result } = runDocument(document);

    expect(result.status).toBe("solved");
    expectClose(result.componentVoltages.V1, -9, { absolute: 1e-9, relative: 1e-9 });
    expectClose(result.branchCurrents.V1, 1, { absolute: 1e-9, relative: 1e-9 });
    expectClose(result.componentPowers.V1, -9, { absolute: 1e-9, relative: 1e-9 });
    expectClose(result.branchCurrents.R1, -1, { absolute: 1e-9, relative: 1e-9 });
    expectClose(result.componentPowers.R1, 9, { absolute: 1e-9, relative: 1e-9 });
  });
});

describe("matrix scaling", () => {
  it("solves resistors separated by twelve orders of magnitude", () => {
    const document = seriesDocument(
      component("Rsmall", "resistor", { resistanceOhm: 1e-6 }),
      1e6,
    );
    document.components.find(({ id }) => id === "V1")!.properties.voltageV = 1;
    const { result } = runDocument(document);
    const expectedCurrent = 1 / (1e-6 + 1e6);

    expect(result.status).toBe("solved");
    expectClose(result.branchCurrents.Rsmall, expectedCurrent, {
      absolute: 1e-9,
      relative: 1e-9,
    });
    expectClose(result.branchCurrents.R1, expectedCurrent, {
      absolute: 1e-9,
      relative: 1e-9,
    });
    expectClose(result.componentVoltages.Rsmall, expectedCurrent * 1e-6, {
      absolute: 1e-15,
      relative: 1e-6,
    });
  });

  it.each([
    ["small", 1e-12, 1e12],
    ["large", 1e12, 1e-12],
  ] as const)("keeps a %s resistance solution finite", (_name, resistance, expectedCurrent) => {
    const fixture = fixturesById.get("FIX-01")!;
    const document: CircuitDocument = JSON.parse(JSON.stringify(fixture.document)) as CircuitDocument;
    document.components.find(({ id }) => id === "V1")!.properties.voltageV = 1;
    document.components.find(({ id }) => id === "R1")!.properties.resistanceOhm = resistance;
    const { result } = runDocument(document);

    expect(result.status).toBe("solved");
    expectClose(result.branchCurrents.R1, expectedCurrent, {
      absolute: Math.abs(expectedCurrent) * 1e-9,
      relative: 1e-9,
    });
    expect(Object.values(result.nodeVoltages).every(Number.isFinite)).toBe(true);
    expect(Object.values(result.componentPowers).every(Number.isFinite)).toBe(true);
  });
});

describe("explicit connectivity", () => {
  it("does not join wires merely because their waypoint coordinates cross", () => {
    const document: CircuitDocument = {
      format: "edu-circuit",
      version: 4,
      documentId: "crossing-wires",
      title: "교차하지만 연결되지 않은 도선",
      components: [
        component("R1", "resistor", { resistanceOhm: 1 }, -50),
        component("R2", "resistor", { resistanceOhm: 1 }, 50),
      ],
      wires: [
        {
          id: "WH",
          start: { kind: "terminal", id: "R1.a" },
          end: { kind: "terminal", id: "R1.b" },
          waypoints: [
            { x: -10, y: 0 },
            { x: 10, y: 0 },
          ],
        },
        {
          id: "WV",
          start: { kind: "terminal", id: "R2.a" },
          end: { kind: "terminal", id: "R2.b" },
          waypoints: [
            { x: 0, y: -10 },
            { x: 0, y: 10 },
          ],
        },
      ],
      junctions: [],
      annotations: [],
      referenceNode: null,
      activity: null,
    };

    const compilation = compileCircuit(document);
    expect(compilation.diagnostics).toEqual([]);
    expect(compilation.circuit.endpointToNet["R1.a"]).toBe(
      compilation.circuit.endpointToNet["R1.b"],
    );
    expect(compilation.circuit.endpointToNet["R2.a"]).toBe(
      compilation.circuit.endpointToNet["R2.b"],
    );
    expect(compilation.circuit.endpointToNet["R1.a"]).not.toBe(
      compilation.circuit.endpointToNet["R2.a"],
    );
  });

  it("preserves endpoint IDs that overlap Object prototype property names", () => {
    const fixture = fixturesById.get("FIX-01")!;
    const document: CircuitDocument = JSON.parse(JSON.stringify(fixture.document)) as CircuitDocument;
    const source = document.components.find(({ id }) => id === "V1")!;
    source.terminals[0].id = "__proto__";
    source.terminals[1].id = "constructor";
    for (const wire of document.wires) {
      if (wire.start.id === "V1.p") wire.start.id = "__proto__";
      if (wire.end.id === "V1.p") wire.end.id = "__proto__";
      if (wire.start.id === "V1.n") wire.start.id = "constructor";
      if (wire.end.id === "V1.n") wire.end.id = "constructor";
    }
    document.referenceNode = { kind: "terminal", id: "constructor" };

    const { circuit, result } = runDocument(document);
    expect(Object.getPrototypeOf(circuit.endpointToNet)).toBeNull();
    expect(circuit.endpointToNet.__proto__).toBeTypeOf("string");
    expect(circuit.endpointToNet.constructor).toBeTypeOf("string");
    expect(result.status).toBe("solved");
    expectClose(result.branchCurrents.R1, 1, { absolute: 1e-9, relative: 1e-9 });
  });
});

describe("ideal zero-volt constraints", () => {
  it.each([
    ["closed switch", component("S1", "switch", { state: "closed" }), "S1"],
    ["ammeter", component("A1", "ammeter", {}), "A1"],
    ["zero-ohm resistor", component("R0", "resistor", { resistanceOhm: 0 }), "R0"],
  ] as const)("solves a %s in series and reports its current", (_name, idealElement, id) => {
    const { result } = runDocument(seriesDocument(idealElement));

    expect(result.status).toBe("solved");
    expectClose(result.branchCurrents[id], 1, { absolute: 1e-9, relative: 1e-9 });
    expectClose(result.componentVoltages[id], 0, { absolute: 1e-9, relative: 1e-9 });
    expectClose(result.componentPowers[id], 0, { absolute: 1e-9, relative: 1e-9 });
  });

  it("reports an ammeter connected in parallel with a nonzero source", () => {
    const { result } = runDocument(parallelDocument(component("A1", "ammeter", {})));

    expect(result.status).toBe("error");
    expect(result.diagnostics.map(({ code }) => code)).toContain("AMMETER_PARALLEL_TO_SOURCE");
    expectNoNumericalResults(result);
  });

  it("reports a redundant equal-voltage source constraint as singular", () => {
    const document = parallelDocument(
      component("V2", "dc-voltage-source", { voltageV: 9 }),
      9,
    );
    const { result } = runDocument(document);

    expect(result.status).toBe("error");
    expect(result.diagnostics.map(({ code }) => code)).toContain("SINGULAR_SYSTEM");
    expectNoNumericalResults(result);
  });

  it("does not invent individual currents for parallel zero-volt constraints", () => {
    const document: CircuitDocument = {
      format: "edu-circuit",
      version: 4,
      documentId: "parallel-zero-volt-constraints",
      title: "병렬 0 V 제약",
      components: [
        component("V1", "dc-voltage-source", { voltageV: 9 }),
        component("S1", "switch", { state: "closed" }, -20),
        component("S2", "switch", { state: "closed" }, 20),
        component("R1", "resistor", { resistanceOhm: 9 }),
      ],
      wires: [
        { id: "W1", start: { kind: "terminal", id: "V1.a" }, end: { kind: "junction", id: "J1" }, waypoints: [] },
        { id: "W2", start: { kind: "junction", id: "J1" }, end: { kind: "terminal", id: "S1.a" }, waypoints: [] },
        { id: "W3", start: { kind: "junction", id: "J1" }, end: { kind: "terminal", id: "S2.a" }, waypoints: [] },
        { id: "W4", start: { kind: "terminal", id: "S1.b" }, end: { kind: "junction", id: "J2" }, waypoints: [] },
        { id: "W5", start: { kind: "terminal", id: "S2.b" }, end: { kind: "junction", id: "J2" }, waypoints: [] },
        { id: "W6", start: { kind: "junction", id: "J2" }, end: { kind: "terminal", id: "R1.a" }, waypoints: [] },
        { id: "W7", start: { kind: "terminal", id: "R1.b" }, end: { kind: "terminal", id: "V1.b" }, waypoints: [] },
      ],
      junctions: [
        { id: "J1", position: { x: 100, y: 0 } },
        { id: "J2", position: { x: 200, y: 0 } },
      ],
      annotations: [],
      referenceNode: { kind: "terminal", id: "V1.b" },
      activity: null,
    };
    const { result } = runDocument(document);

    expect(result.status).toBe("error");
    expect(result.diagnostics.map(({ code }) => code)).toContain("SINGULAR_SYSTEM");
    expectNoNumericalResults(result);
  });

  it("reports inconsistent parallel voltage constraints", () => {
    const document = parallelDocument(
      component("V2", "dc-voltage-source", { voltageV: 5 }),
      9,
    );
    const { result } = runDocument(document);

    expect(result.status).toBe("error");
    expect(result.diagnostics.map(({ code }) => code)).toContain("CONFLICTING_SOURCES");
    expectNoNumericalResults(result);
  });
});

describe("invalid physical values", () => {
  it.each([
    ["negative resistance", component("X1", "resistor", { resistanceOhm: -1 })],
    ["missing resistance", component("X1", "resistor", {})],
    ["wrong resistance type", component("X1", "resistor", { resistanceOhm: "9" })],
    ["non-finite resistance", component("X1", "resistor", { resistanceOhm: Infinity })],
    ["missing voltage", component("X1", "dc-voltage-source", {})],
    ["wrong voltage type", component("X1", "dc-voltage-source", { voltageV: "9" })],
    ["non-finite voltage", component("X1", "dc-voltage-source", { voltageV: Infinity })],
    ["unknown switch state", component("X1", "switch", { state: "half-open" })],
  ] as const)("rejects %s during compilation", (_name, invalidComponent) => {
    const compilation = compileCircuit(seriesDocument(invalidComponent));

    expect(compilation.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_COMPONENT_VALUE", affectedIds: ["X1"] }),
      ]),
    );
    expect(compilation.diagnostics.some(({ severity }) => severity === "error")).toBe(true);
  });

  it("rejects finite inputs whose computed power overflows", () => {
    const fixture = fixturesById.get("FIX-01")!;
    const document: CircuitDocument = JSON.parse(JSON.stringify(fixture.document)) as CircuitDocument;
    document.components.find(({ id }) => id === "V1")!.properties.voltageV = 1e308;

    const { result } = runDocument(document);
    expect(result.status).toBe("error");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ILL_CONDITIONED_SYSTEM" })]),
    );
    expectNoNumericalResults(result);
  });

  it("rejects components with more than two terminals", () => {
    const invalid = component("X1", "resistor", { resistanceOhm: 9 });
    invalid.terminals.push({ id: "X1.c", role: "c" });
    const compilation = compileCircuit(seriesDocument(invalid));

    expect(compilation.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_TERMINALS", affectedIds: ["X1"] }),
      ]),
    );
  });

  it.each([
    ["negative", -1],
    ["non-finite", Infinity],
  ] as const)("defensively rejects a %s compiled element value", (_name, value) => {
    const circuit: CompiledCircuit = {
      nets: [
        { id: "N0", endpointIds: [], wireIds: [] },
        { id: "N1", endpointIds: [], wireIds: [] },
      ],
      elements: [
        { id: "R1", type: "resistor", a: "N1", b: "N0", value, closed: true },
      ],
      endpointToNet: {},
      referenceNetId: "N0",
    };

    const result = solveCircuit(circuit);
    expect(result.status).toBe("error");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_COMPONENT_VALUE", affectedIds: ["R1"] }),
      ]),
    );
    expectNoNumericalResults(result);
  });
});
