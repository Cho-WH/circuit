import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { wirePoints } from "../src/component-library";
import { compileCircuit } from "../src/connectivity";
import type {
  CircuitDocument,
  CompiledCircuit,
  CompiledElement,
  SimulationResult,
} from "../src/domain";
import { solveCircuit } from "../src/simulation";
import {
  buildPotentialModel,
  makePath,
  pathVoltages,
  potentialColor,
  defaultPotentialPalette,
  potentialPalettes,
  potentialGradient,
  suggestPaths,
} from "../src/visualization";

const root = resolve(process.cwd());

function fixture(filename: string): CircuitDocument {
  const parsed = JSON.parse(
    readFileSync(join(root, "fixtures", filename), "utf8"),
  ) as { document: CircuitDocument };
  return parsed.document;
}

function solvedModel(filename: string, options: Parameters<typeof buildPotentialModel>[3] = {}) {
  const document = fixture(filename);
  const compilation = compileCircuit(document);
  expect(compilation.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  const result = solveCircuit(compilation.circuit);
  expect(result.status).toBe("solved");
  return {
    document,
    circuit: compilation.circuit,
    result,
    model: buildPotentialModel(document, compilation.circuit, result, options),
  };
}

describe("potential model invariants", () => {
  it("shares one value object across every endpoint on the same net", () => {
    const { circuit, model } = solvedModel("FIX-03-parallel.json");

    for (const net of circuit.nets) {
      const value = model.nets[net.id];
      expect(value.endpointIds).toEqual(net.endpointIds);
      expect(value.wireIds).toEqual(net.wireIds);
      for (const endpointId of net.endpointIds) {
        expect(model.endpoints[endpointId]).toBe(value);
      }
    }
    expect(model.endpoints.JT).toBe(model.endpoints["R1.a"]);
    expect(model.endpoints.JT).toBe(model.endpoints["R2.a"]);
    expect(model.endpoints.JT.voltage).toBeCloseTo(6, 12);
  });

  it("keeps every ideal-wire point flat and preserves the document x-y geometry", () => {
    const { document, model } = solvedModel("FIX-02-series.json", { scale: 7 });

    for (const wire of document.wires) {
      const segment = model.segments.find(({ id, kind }) => id === wire.id && kind === "wire");
      expect(segment).toBeDefined();
      const expectedXY = wirePoints(document, wire);
      expect(segment!.points.map(({ x, y }) => ({ x, y }))).toStrictEqual(expectedXY);
      expect(new Set(segment!.points.map(({ z }) => z)).size).toBe(1);
      expect(segment!.points[0].z).toBe(model.endpoints[wire.start.id].height);
      expect(segment!.points.at(-1)!.z).toBe(model.endpoints[wire.end.id].height);
    }
  });

  it("uses one fixed range to map equal voltages to equal colors across circuits", () => {
    const fixed = { min: -9, max: 9 };
    const series = solvedModel("FIX-02-series.json", { range: fixed }).model;
    const parallel = solvedModel("FIX-03-parallel.json", { range: fixed }).model;

    expect(series.min).toBe(-9);
    expect(series.max).toBe(9);
    expect(parallel.min).toBe(-9);
    expect(parallel.max).toBe(9);
    expect(series.endpoints.J1.voltage).toBe(6);
    expect(parallel.endpoints.JT.voltage).toBe(6);
    expect(series.endpoints.J1.color).toBe(parallel.endpoints.JT.color);
  });

  it("shifts all heights by the reference change while preserving voltage differences", () => {
    const ordinary = solvedModel("FIX-02-series.json", { scale: 10 }).model;
    const shifted = solvedModel("FIX-10-reference-shift.json", { scale: 10 }).model;
    const endpointIds = ["V1.p", "J1", "V1.n"];

    for (const id of endpointIds) {
      expect(ordinary.endpoints[id].height! - shifted.endpoints[id].height!).toBeCloseTo(60, 10);
    }
    for (const [first, second] of [["V1.p", "J1"], ["J1", "V1.n"]] as const) {
      const ordinaryDifference = ordinary.endpoints[first].height! - ordinary.endpoints[second].height!;
      const shiftedDifference = shifted.endpoints[first].height! - shifted.endpoints[second].height!;
      expect(shiftedDifference).toBeCloseTo(ordinaryDifference, 10);
    }
    expect(shifted.endpoints.J1.height).toBe(0);
  });

  it("leaves an open switch as a real 3D gap between independently valued terminals", () => {
    const { model } = solvedModel("FIX-05-open-switch.json");

    expect(model.segments.some(({ id }) => id === "S1")).toBe(false);
    expect(model.endpoints["S1.a"]).not.toBe(model.endpoints["S1.b"]);
    expect(model.endpoints["S1.a"].voltage).toBeCloseTo(9, 12);
    expect(model.endpoints["S1.b"].voltage).toBeCloseTo(0, 12);
    expect(model.endpoints["S1.a"].height).not.toBe(model.endpoints["S1.b"].height);
  });

  it("assigns no arbitrary height, color, or segment to a floating result", () => {
    const document = fixture("FIX-07-floating-network.json");
    const { circuit } = compileCircuit(document);
    const result = solveCircuit(circuit);
    expect(result.status).toBe("error");

    const model = buildPotentialModel(document, circuit, result);
    expect(model.undefinedCount).toBe(circuit.nets.length);
    expect(model.segments).toEqual([]);
    for (const value of Object.values(model.nets)) {
      expect(value.voltage).toBeUndefined();
      expect(value.height).toBeUndefined();
      expect(value.color).toBe("#9aa5b3");
    }
  });

  it("uses a stable midpoint color for a single potential and clamps fixed-range overflow", () => {
    expect(potentialColor(0, 0, 0)).toBe("rgb(127,255,128)");
    expect(potentialColor(-20, -10, 10)).toBe(potentialColor(-10, -10, 10));
    expect(potentialColor(20, -10, 10)).toBe(potentialColor(10, -10, 10));
    expect(potentialColor(Number.NaN, -10, 10)).toBe("#9aa5b3");
  });
});

describe("approved potential palettes", () => {
  it("defaults to the accepted spectrum with navy lows and the unchanged red end", () => {
    expect(defaultPotentialPalette).toBe('spectrum');
    expect([0,3,6,9,12].map(v=>potentialColor(v,0,12))).toEqual([
      'rgb(0,0,168)', 'rgb(0,148,255)', 'rgb(127,255,128)', 'rgb(255,191,0)', 'rgb(255,0,0)',
    ]);
    expect(potentialColor(6 - 1e-8, 0, 12)).toBe(potentialColor(6 + 1e-8, 0, 12));
  });
  it('preserves the final A/C colors and their low-to-high direction', () => {
    expect([0,6,12].map(v=>potentialColor(v,0,12,'blue-yellow'))).toEqual(['rgb(34,52,165)','rgb(0,189,182)','rgb(244,223,0)']);
    expect([0,12].map(v=>potentialColor(v,0,12,'red-yellow'))).toEqual(['rgb(128,13,38)','rgb(255,228,90)']);
  });
  for (const palette of potentialPalettes) {
    it(`${palette.id}: changes only color, with shared endpoint/wire values and matching legend ends`, () => {
      const { document, circuit, result, model: original } = solvedModel('FIX-02-series.json');
      const snapshot = JSON.stringify({document,result});
      const model = buildPotentialModel(document,circuit,result,{palette:palette.id});
      for(const net of circuit.nets) {
        const n=model.nets[net.id];
        expect(n.voltage).toBe(original.nets[net.id].voltage);
        expect(n.height).toBe(original.nets[net.id].height);
        net.endpointIds.forEach(id=>expect(model.endpoints[id]).toBe(n));
        net.wireIds.forEach(id=>expect(model.segments.find(s=>s.id===id)?.color).toBe(n.color));
      }
      expect(model.segments.map(s=>s.points)).toEqual(original.segments.map(s=>s.points));
      expect(JSON.stringify({document,result})).toBe(snapshot);
      expect(potentialGradient(palette.id)).toContain(potentialColor(0,0,12,palette.id));
      expect(potentialGradient(palette.id)).toContain(potentialColor(12,0,12,palette.id));
      expect(potentialColor(-100,-9,9,palette.id)).toBe(potentialColor(-9,-9,9,palette.id));
      expect(potentialColor(100,-9,9,palette.id)).toBe(potentialColor(9,-9,9,palette.id));
      expect(potentialColor(0,0,0,palette.id)).toBe(potentialColor(6,0,12,palette.id));
      expect(potentialColor(undefined,0,12,palette.id)).toBe('#9aa5b3');
      expect(potentialColor(Number.NaN,0,12,palette.id)).toBe('#9aa5b3');
      const floating=fixture('FIX-07-floating-network.json'),compiled=compileCircuit(floating).circuit;
      const undefinedModel=buildPotentialModel(floating,compiled,solveCircuit(compiled),{palette:palette.id});
      expect(undefinedModel.segments).toEqual([]);
      expect(Object.values(undefinedModel.nets).every(n=>n.height===undefined&&n.color==='#9aa5b3')).toBe(true);
      const fixed={range:{min:-9,max:9},palette:palette.id};
      expect(solvedModel('FIX-02-series.json',fixed).model.endpoints.J1.color).toBe(solvedModel('FIX-03-parallel.json',fixed).model.endpoints.JT.color);
    });
  }
});

describe("potential paths", () => {
  it("suggests the series loop deterministically and its voltage changes satisfy KVL", () => {
    const { circuit, result } = solvedModel("FIX-02-series.json");
    const paths = suggestPaths(circuit);

    expect(paths).toHaveLength(1);
    expect(paths[0].steps.map(({ elementId }) => elementId)).toEqual(["V1", "R1", "R2"]);
    const graph = pathVoltages(paths[0], result);
    expect(graph.every(({ fromVoltage, toVoltage }) => Number.isFinite(fromVoltage) && Number.isFinite(toVoltage))).toBe(true);
    const loopChange = graph.reduce(
      (sum, { fromVoltage, toVoltage }) => sum + toVoltage! - fromVoltage!,
      0,
    );
    expect(loopChange).toBeCloseTo(0, 12);
    expect(graph.map(({ elementId, fromVoltage, toVoltage }) => ({ elementId, fromVoltage, toVoltage }))).toEqual([
      { elementId: "V1", fromVoltage: 0, toVoltage: 9 },
      { elementId: "R1", fromVoltage: 9, toVoltage: 6 },
      { elementId: "R2", fromVoltage: 6, toVoltage: 0 },
    ]);
  });

  it("builds continuous custom paths and rejects nonadjacent element sequences", () => {
    const { circuit } = solvedModel("FIX-02-series.json");
    const custom = makePath(circuit, ["V1", "R1", "R2"]);
    expect(custom?.steps.map(({ elementId }) => elementId)).toEqual(["V1", "R1", "R2"]);
    custom!.steps.slice(1).forEach((step, index) => {
      expect(step.from).toBe(custom!.steps[index].to);
    });

    const element = (id: string, a: string, b: string): CompiledElement => ({
      id,
      type: "resistor",
      a,
      b,
      value: 1,
      closed: false,
    });
    const disconnected: CompiledCircuit = {
      nets: ["a", "b", "c", "d"].map((id) => ({ id, endpointIds: [], wireIds: [] })),
      elements: [element("R1", "a", "b"), element("R2", "c", "d")],
      endpointToNet: {},
      referenceNetId: "a",
    };
    expect(makePath(disconnected, ["R1", "R2"])).toBeNull();
    expect(makePath(circuit, ["missing"])).toBeNull();
    expect(makePath(circuit, [])).toBeNull();
  });

  it("preserves undefined endpoint voltages in graph data instead of inventing values", () => {
    const { circuit } = solvedModel("FIX-02-series.json");
    const path = makePath(circuit, ["V1", "R1", "R2"])!;
    const failed: SimulationResult = {
      status: "error",
      nodeVoltages: {},
      branchCurrents: {},
      componentVoltages: {},
      componentPowers: {},
      diagnostics: [],
    };

    expect(pathVoltages(path, failed).every(({ fromVoltage, toVoltage }) =>
      fromVoltage === undefined && toVoltage === undefined,
    )).toBe(true);
  });
});
