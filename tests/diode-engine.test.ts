import { describe, expect, it } from 'vitest';
import type { CompiledCircuit, CompiledElement, OperatingProfile, Rational } from '../src/domain';
import * as q from '../src/rational';
import {
  analyzeOperatingCircuit,
  assessOperatingPoint,
  checkKcl,
  equivalentResistance,
  queryCurrent,
  queryVoltage,
  solveCircuit,
} from '../src/simulation';
import { compileCircuit } from '../src/connectivity';
import { requireDocument } from '../src/domain';
import { probeCurrent, probeVoltage } from '../src/measurement';
import { readFileSync } from 'node:fs';

const fraction = (n: number, d = 1) => q.rational(BigInt(n), BigInt(d));
const sourceProfile: OperatingProfile = {
  id: 'test-source',
  revision: 1,
  sourceResistanceOhm: fraction(10),
  boundaries: {},
};
const diodeProfile: OperatingProfile = {
  id: 'test-diode',
  revision: 1,
  diodeThresholdV: fraction(7, 10),
  diodeOnResistanceOhm: fraction(10),
  boundaries: { forwardCurrent: { continuousMax: fraction(1, 20), damageAt: fraction(1, 10) } },
};
const resistorProfile: OperatingProfile = { id: 'test-resistor', revision: 1, boundaries: {} };
function element(
  id: string,
  type: CompiledElement['type'],
  a: string,
  b: string,
  value: number | Rational = 0,
): CompiledElement {
  return {
    id,
    type,
    a,
    b,
    value: q.from(value),
    closed: true,
    operatingProfile: structuredClone(
      type === 'diode'
        ? diodeProfile
        : type === 'dc-voltage-source'
          ? sourceProfile
          : resistorProfile,
    ),
  };
}
function circuit(
  elements: CompiledElement[],
  referenceNetId: string | undefined = 'g',
): CompiledCircuit {
  return {
    elements,
    nets: [...new Set(elements.flatMap((e) => [e.a, e.b]))]
      .sort()
      .map((id) => ({ id, endpointIds: [id], wireIds: [] })),
    endpointToNet: Object.fromEntries(
      elements.flatMap((e) => [
        [e.a, e.a],
        [e.b, e.b],
      ]),
    ),
    referenceNetId,
  };
}
function series(
  resistance: number | Rational | null,
  source = 3,
  reverse = false,
): CompiledCircuit {
  return circuit([
    element('V', 'dc-voltage-source', 'p', 'g', source),
    ...(resistance === null ? [] : [element('R', 'resistor', 'p', 'a', resistance)]),
    element(
      'D',
      'diode',
      reverse ? 'g' : resistance === null ? 'p' : 'a',
      reverse ? (resistance === null ? 'p' : 'a') : 'g',
      fraction(7, 10),
    ),
  ]);
}
const component = (input: CompiledCircuit) => solveCircuit(input, { physicalModel: 'component' });

describe('exact diode textbook operating sets (DIO-E)', () => {
  it('preserves the documented interior voltage maximum during a diode state transition', () => {
    const input = circuit([
      element('V5', 'dc-voltage-source', 'p', 'g', 5),
      element('V23', 'dc-voltage-source', 'c', 'g', fraction(23, 10)),
      element('Rpa', 'resistor', 'p', 'a', 1000),
      element('Rbg', 'resistor', 'b', 'g', 1000),
      element('Ray', 'resistor', 'a', 'y', 1000),
      element('Ryb', 'resistor', 'y', 'b', 3000),
      element('variable', 'resistive-load', 'a', 'b', 100),
      element('D', 'diode', 'a', 'c', fraction(7, 10)),
    ]);
    const values: Rational[] = [];
    for (const [resistance, expected] of [
      [fraction(100), fraction(110, 43)],
      [fraction(4000, 7), fraction(11, 4)],
      [fraction(10000), fraction(22, 9)],
    ]) {
      input.elements.find((e) => e.id === 'variable')!.value = resistance;
      const result = solveCircuit(input);
      expect(result.status).toBe('solved');
      expect(result.nodeVoltages.y).toEqual(expected);
      values.push(result.nodeVoltages.y);
    }
    expect(q.compare(values[1], values[0])).toBeGreaterThan(0);
    expect(q.compare(values[1], values[2])).toBeGreaterThan(0);
  });
  it('E02/E03 preserves exact forward drop and true reverse blocking', () => {
    const forward = solveCircuit(series(1000, 5));
    expect(forward.status).toBe('solved');
    expect(forward.componentVoltages.D).toEqual(fraction(7, 10));
    expect(forward.branchCurrents.D).toEqual(fraction(43, 10000));
    const reverse = solveCircuit(series(1000, 5, true));
    expect(reverse.branchCurrents.D).toEqual(q.ZERO);
    expect(reverse.componentVoltages.D).toEqual(fraction(-5));
  });
  it('E04 treats duplicate threshold masks as one boundary, without inventing branch current', () => {
    const result = solveCircuit(series(null, 0.7));
    expect(result.solution).toBe('nonunique');
    expect(result.componentVoltages.D).toEqual(fraction(7, 10));
    expect(result.branchCurrents.D).toBeUndefined();
    expect(queryCurrent(result, [{ componentId: 'D', coefficient: 1 }])).toEqual({
      status: 'nonunique',
      minimum: q.ZERO,
    });
  });
  it('E05 selects the symmetric equilibrium inside the admissible middle-node range', () => {
    const input = circuit([
      element('V', 'dc-voltage-source', 'p', 'g', 1),
      element('D1', 'diode', 'p', 'm', 0.7),
      element('D2', 'diode', 'm', 'g', 0.7),
    ]);
    const result = solveCircuit(input);
    expect(result.branchCurrents.D1).toEqual(q.ZERO);
    expect(result.branchCurrents.D2).toEqual(q.ZERO);
    expect(result.nodeVoltages.m).toEqual(fraction(1, 2));
    expect(queryVoltage(result, 'm', 'g')).toEqual({
      status: 'unique',
      value: fraction(1, 2),
    });
    expect(queryVoltage(result, 'm', 'm')).toEqual({ status: 'unique', value: q.ZERO });
    input.elements[0].value = fraction(3, 2);
    const conflict = solveCircuit(input);
    expect(conflict.solution).toBe('infeasible');
    expect(conflict.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'INFEASIBLE_OPERATING_POINT',
        affectedIds: ['D1', 'D2', 'V'],
      }),
    );
  });
  it('E07/E10 directly queries fixed KCL sums despite nonunique parallel branch currents', () => {
    const input = series(1000, 5);
    input.elements.push({
      ...structuredClone(input.elements.find((e) => e.id === 'D')!),
      id: 'D2',
    });
    const result = solveCircuit(input);
    expect(result.branchCurrents.R).toEqual(fraction(43, 10000));
    expect(result.branchCurrents.D).toBeUndefined();
    expect(result.branchCurrents.D2).toBeUndefined();
    expect(
      queryCurrent(result, [
        { componentId: 'D', coefficient: 1 },
        { componentId: 'D2', coefficient: 1 },
      ]),
    ).toEqual({ status: 'unique', value: fraction(43, 10000) });
    expect(checkKcl(input, result, 'a')).toMatchObject({
      defined: true,
      passes: true,
      sum: q.ZERO,
    });
    expect(queryCurrent(result, [{ componentId: 'D', coefficient: 1 }])).toEqual({
      status: 'nonunique',
      minimum: q.ZERO,
      maximum: fraction(43, 10000),
    });
  });
  it('E08 separates redundant and contradictory ideal source constraints', () => {
    const equal = circuit([
      element('V1', 'dc-voltage-source', 'p', 'g', 5),
      element('V2', 'dc-voltage-source', 'p', 'g', 5),
    ]);
    const result = solveCircuit(equal);
    expect(result.solution).toBe('nonunique');
    expect(result.componentVoltages.V1).toEqual(fraction(5));
    expect(result.branchCurrents.V1).toBeUndefined();
    equal.elements[1].value = fraction(6);
    expect(solveCircuit(equal).status).toBe('error');
  });
  it('E09 resolves differences in a floating island without assigning arbitrary node potentials', () => {
    const input = series(1000, 5);
    input.referenceNetId = undefined;
    const result = solveCircuit(input);
    expect(Object.keys(result.nodeVoltages)).toHaveLength(0);
    expect(queryVoltage(result, 'p', 'g')).toEqual({ status: 'unique', value: fraction(5) });
    expect(queryVoltage(result, 'a', 'g')).toEqual({ status: 'unique', value: fraction(7, 10) });
    expect(result.branchCurrents.D).toEqual(fraction(43, 10000));
  });
  it('retains a valid island when another island has no operating point', () => {
    const input = series(1000, 5);
    input.elements.push(
      element('VX', 'dc-voltage-source', 'x', 'y', 5),
      element('DX', 'diode', 'x', 'y', 0.7),
    );
    input.nets.push(
      { id: 'x', endpointIds: [], wireIds: [] },
      { id: 'y', endpointIds: [], wireIds: [] },
    );
    const result = solveCircuit(input);
    expect(result.status).toBe('warning');
    expect(result.branchCurrents.D).toEqual(fraction(43, 10000));
    expect(result.branchCurrents.DX).toBeUndefined();
    expect(queryVoltage(result, 'x', 'y').status).toBe('unverified');
    expect(queryVoltage(result, 'p', 'x').status).toBe('nonunique');
  });
  it('E11 preserves results under element and net reordering', () => {
    const input = series(1000, 5),
      reversed = {
        ...input,
        elements: [...input.elements].reverse(),
        nets: [...input.nets].reverse(),
      };
    expect(solveCircuit(reversed)).toEqual(solveCircuit(input));
    expect(component(reversed)).toEqual(component(input));
  });
  it('E12 bounds state enumeration without inventing a zero or danger event', () => {
    const input = series(1000, 5);
    for (let i = 0; i < 11; i++)
      input.elements.push({ ...input.elements.find((e) => e.id === 'D')!, id: `extra-${i}` });
    const result = solveCircuit(input);
    expect(result.solution).toBe('unverified');
    expect(Object.keys(result.branchCurrents)).toHaveLength(0);
    expect(assessOperatingPoint(input, result).status).toBe('unverified');
  });
  it('E12 rejects an exact integer-budget overflow without relabeling it as infeasibility', () => {
    const input = series(1000, 5);
    input.elements[0].value = q.rational(1n << 4097n);
    const result = solveCircuit(input);
    expect(result.solution).toBe('unverified');
    expect(Object.keys(result.branchCurrents)).toHaveLength(0);
    expect(assessOperatingPoint(input, result).status).toBe('unverified');
  });
  it('routes floating voltage and A/K current measurements through the public measurement API', () => {
    const document = requireDocument(
      JSON.parse(readFileSync('fixtures/FIX-13-forward-diode.json', 'utf8')).document,
    );
    document.referenceNode = null;
    const diode = document.components.find((c) => c.type === 'diode')!;
    diode.terminals.reverse();
    const compilation = compileCircuit(document),
      result = solveCircuit(compilation.circuit);
    const current = probeCurrent(document, compilation, result, {
      kind: 'component',
      id: diode.id,
    });
    expect(current).toMatchObject({
      ok: true,
      value: {
        amperes: fraction(43, 10000),
        from: { id: diode.terminals.find((t) => t.role === 'anode')!.id },
      },
    });
    expect(
      probeVoltage(
        compilation,
        result,
        { kind: 'terminal', id: diode.terminals.find((t) => t.role === 'anode')!.id },
        { kind: 'terminal', id: diode.terminals.find((t) => t.role === 'cathode')!.id },
      ),
    ).toMatchObject({ ok: true, value: { voltageV: fraction(7, 10) } });
    expect(result.nodeVoltages).toEqual({});
  });
  it('E13 rejects only equivalent-resistance ports connected to a diode island', () => {
    const input = series(1000, 5);
    input.elements.push(element('independent', 'resistor', 'x', 'y', 20));
    input.nets.push(
      { id: 'x', endpointIds: [], wireIds: [] },
      { id: 'y', endpointIds: [], wireIds: [] },
    );
    expect(equivalentResistance(input, 'p', 'g').diagnostics[0].code).toBe(
      'NONLINEAR_RESISTANCE_UNSUPPORTED',
    );
    expect(equivalentResistance(input, 'x', 'y')).toMatchObject({
      status: 'finite',
      ohms: fraction(20),
    });
  });
});

describe('zero-leakage diode equilibrium', () => {
  it.each(['textbook','component'] as const)('resolves every series switch position and diode direction in the %s model', physicalModel => {
    for (const position of [0,1,2]) for (const reverse of [false,true]) {
      const input=series(1000,5,reverse);
      const [source,resistor,diode]=input.elements;
      const node=position===0?'p':position===1?'a':'g';
      if(position===0)resistor.a='s';
      else if(position===1)resistor.b='s';
      else if(reverse)diode.a='s';
      else diode.b='s';
      const sw={...element('S','switch',node,'s'),closed:false};
      const switched=circuit([...input.elements,sw]);
      const result=solveCircuit(switched,{physicalModel});
      expect(result.solution).toBe('unique');
      expect(result.status).toBe('solved');
      expect(result.branchCurrents).toEqual({V:q.ZERO,R:q.ZERO,D:q.ZERO,S:q.ZERO});
      expect(result.componentVoltages.D).toEqual(q.ZERO);
      expect(result.componentVoltages.R).toEqual(q.ZERO);
      expect(result.componentVoltages.V).toEqual(fraction(5));
      expect(q.abs(result.componentVoltages.S)).toEqual(fraction(5));
      expect(queryVoltage(result,diode.a,diode.b)).toEqual({status:'unique',value:q.ZERO});
      expect(queryCurrent(result,[{componentId:'D',coefficient:1}])).toEqual({status:'unique',value:q.ZERO});
      expect(result.componentPowers.D).toEqual(q.ZERO);
      for(const net of switched.nets)expect(checkKcl(switched,result,net.id)).toMatchObject({defined:true,passes:true,sum:q.ZERO});
      sw.closed=true;
      const closed=solveCircuit(switched,{physicalModel});
      expect(closed.componentVoltages.V).toEqual(solveCircuit(series(1000,5,reverse),{physicalModel}).componentVoltages.V);
      expect(closed.branchCurrents.D).toEqual(solveCircuit(series(1000,5,reverse),{physicalModel}).branchCurrents.D);
      sw.closed=false;
      expect(solveCircuit(switched,{physicalModel})).toEqual(result);
      expect(source.value).toEqual(fraction(5));
    }
  });

  it('honors an active diode voltage bound instead of choosing an infeasible average', () => {
    const d1=element('D1','diode','p','m',0.7),d2=element('D2','diode','m','g',0.7);
    d1.operatingProfile!.diodeThresholdV=fraction(1,5);
    d2.operatingProfile!.diodeThresholdV=fraction(9,10);
    const input=circuit([element('V','dc-voltage-source','p','g',1),d1,d2]);
    const result=component(input);
    expect(result.solution).toBe('unique');
    expect(result.componentVoltages.D1).toEqual(fraction(1,5));
    expect(result.componentVoltages.D2).toEqual(fraction(4,5));
    expect(result.branchCurrents).toEqual({V:q.ZERO,D1:q.ZERO,D2:q.ZERO});
    expect(component({...input,nets:[...input.nets].reverse(),elements:[...input.elements].reverse()})).toEqual(result);
    // Renaming IDs must not select a different minimizing face.
    const renamed=circuit(input.elements.map(e=>({...e,id:`renamed-${e.id}`})));
    expect(component(renamed).nodeVoltages).toEqual(result.nodeVoltages);
  });

  it('shares externally forced reverse voltage across series blockers with exactly zero current', () => {
    const input=circuit([element('V','dc-voltage-source','p','g',5),element('D1','diode','g','m',0.7),element('D2','diode','m','p',0.7)]);
    const result=solveCircuit(input);
    expect(result.solution).toBe('unique');
    expect(result.componentVoltages.D1).toEqual(fraction(-5,2));
    expect(result.componentVoltages.D2).toEqual(fraction(-5,2));
    expect(result.branchCurrents).toEqual({V:q.ZERO,D1:q.ZERO,D2:q.ZERO});
    input.referenceNetId='p';
    const shifted=solveCircuit(input);
    expect(shifted.componentVoltages).toEqual(result.componentVoltages);
    expect(shifted.nodeVoltages.m).toEqual(fraction(-5,2));
    input.referenceNetId=undefined;
    const floating=solveCircuit(input);
    expect(Object.keys(floating.nodeVoltages)).toHaveLength(0);
    expect(queryVoltage(floating,'g','m')).toEqual({status:'unique',value:fraction(-5,2)});
  });

  it('satisfies multiple active voltage bounds and retains an independent floating island', () => {
    const d1=element('D1','diode','p','a',0.7),d2=element('D2','diode','a','b',0.7),d3=element('D3','diode','b','g',0.7);
    d1.operatingProfile!.diodeThresholdV=fraction(1,5);
    d2.operatingProfile!.diodeThresholdV=fraction(3,10);
    d3.operatingProfile!.diodeThresholdV=fraction(2);
    const input=circuit([element('V','dc-voltage-source','p','g',fraction(8,5)),d1,d2,d3,element('floating','diode','x','y',0.7)]);
    const result=component(input);
    expect(result.componentVoltages.D1).toEqual(fraction(1,5));
    expect(result.componentVoltages.D2).toEqual(fraction(3,10));
    expect(result.componentVoltages.D3).toEqual(fraction(11,10));
    expect(result.componentVoltages.floating).toEqual(q.ZERO);
    expect(Object.values(result.branchCurrents).every(v=>q.sign(v)===0)).toBe(true);
    expect(result.nodeVoltages.x).toBeUndefined();
    expect(queryVoltage(result,'x','y')).toEqual({status:'unique',value:q.ZERO});
    expect(queryVoltage(result,'g','x').status).toBe('nonunique');
  });

  it('preserves true small forward currents and forced subthreshold voltages', () => {
    const tiny=solveCircuit(series(fraction(1000000000000),5));
    expect(tiny.branchCurrents.D).toEqual(q.rational(43n,10000000000000n));
    expect(tiny.componentVoltages.D).toEqual(fraction(7,10));
    const held=solveCircuit(series(null,0.3));
    expect(held.componentVoltages.D).toEqual(fraction(3,10));
    expect(held.branchCurrents.D).toEqual(q.ZERO);
    expect(held.provenance?.profileRevision).toContain('diode-equilibrium-1|');
  });
});

describe('finite component models and verified boundaries (DIO-B)', () => {
  it.each([
    [100, 23, 1200, 'normal'],
    [26, 1, 20, 'normal'],
    [10, 23, 300, 'overload'],
    [3, 1, 10, 'damage'],
    [null, 23, 200, 'damage'],
  ] as const)(
    'B01–05 solves R=%s with exact current before boundary comparison',
    (r, n, d, state) => {
      const input = series(r),
        result = component(input);
      expect(result.branchCurrents.D).toEqual(fraction(n, d));
      expect(result.branchCurrents.V).toEqual(fraction(-n, d));
      expect(assessOperatingPoint(input, result).status).toBe(state);
      expect(result.provenance).toMatchObject({
        physicalModel: 'component',
        arithmeticQuality: 'exact',
      });
    },
  );
  it('B05 keeps voltage, power and internal loss consistent with the assessed current', () => {
    const input = series(null),
      result = component(input);
    expect(result.componentVoltages.D).toEqual(fraction(37, 20));
    expect(result.componentPowers.D).toEqual(fraction(851, 4000));
    input.elements[0].operatingProfile!.boundaries.internalPower = {
      continuousMax: q.ZERO,
      damageAt: q.ONE,
    };
    expect(
      assessOperatingPoint(input, result).components.find((c) => c.reason === 'internalPower')
        ?.value,
    ).toEqual(fraction(529, 4000));
  });
  it('B06/B07 resolves symmetric and stored asymmetric parallel sharing', () => {
    const input = series(null);
    input.elements.push({ ...structuredClone(input.elements[1]), id: 'D2' });
    const symmetric = component(input);
    expect(symmetric.branchCurrents.D).toEqual(fraction(23, 300));
    expect(symmetric.branchCurrents.D2).toEqual(fraction(23, 300));
    input.elements[1].operatingProfile!.diodeThresholdV = fraction(13, 20);
    input.elements[2].operatingProfile!.diodeThresholdV = fraction(3, 4);
    const asymmetric = component(input);
    expect(asymmetric.componentVoltages.D).toEqual(fraction(22, 15));
    expect(asymmetric.branchCurrents.D).toEqual(fraction(49, 600));
    expect(asymmetric.branchCurrents.D2).toEqual(fraction(43, 600));
    expect(component(input)).toEqual(asymmetric);
  });
  it('B08/B09 allows safe direct connection and threshold-zero boundary', () => {
    const input = series(null);
    input.elements[0].operatingProfile!.sourceResistanceOhm = fraction(100);
    expect(component(input).branchCurrents.D).toEqual(fraction(23, 1100));
    expect(analyzeOperatingCircuit(input).assessment.status).toBe('normal');
    const boundary = analyzeOperatingCircuit(series(null, 0.7));
    expect(boundary.result.branchCurrents.D).toEqual(q.ZERO);
    expect(boundary.result.provenance?.physicalModel).toBe('component');
    expect(boundary.assessment.status).toBe('normal');
  });
  it.each([
    [4600001, 'textbook', 'normal'],
    [4600000, 'textbook', 'normal'],
    [4599999, 'component', 'normal'],
    [2600001, 'component', 'normal'],
    [2600000, 'component', 'normal'],
    [2599999, 'component', 'overload'],
    [300001, 'component', 'overload'],
    [300000, 'component', 'damage'],
    [299999, 'component', 'damage'],
  ] as const)('separates model selection from confirmed risk at R=%s/100000', (n, model, status) => {
    // E=3 V, V0=.7 V, Rs+Ron=20 Ω; Imax=.05 A, Idamage=.1 A.
    const input = series(fraction(n, 100000));
    const evaluated = analyzeOperatingCircuit(input);
    expect(evaluated.result.provenance?.physicalModel).toBe(model);
    expect(evaluated.assessment.status).toBe(status);
    expect(evaluated.assessment).toEqual(assessOperatingPoint(input, evaluated.result));
    expect(evaluated.result.branchCurrents.D).toEqual(
      q.div(fraction(23, 10), q.add(fraction(n, 100000), model === 'component' ? fraction(20) : q.ZERO)),
    );
    expect(analyzeOperatingCircuit(input)).toEqual(evaluated);
  });
  it('B11 can confirm reverse-voltage damage with exact zero heating power', () => {
    const input = series(1000, 5, true);
    input.elements[2].operatingProfile!.boundaries = {
      reverseVoltage: { continuousMax: fraction(3), damageAt: fraction(5) },
    };
    const result = component(input),
      assessment = assessOperatingPoint(input, result);
    expect(result.branchCurrents.D).toEqual(q.ZERO);
    expect(result.componentPowers.D).toEqual(q.ZERO);
    expect(assessment).toMatchObject({
      status: 'damage',
      representative: { componentId: 'D', reason: 'reverseVoltage', value: fraction(5) },
    });
  });
  it('B10/B15 assesses each explicit power boundary and chooses a stable representative cause', () => {
    const input = series(10),
      result = component(input);
    input.elements[1].operatingProfile!.boundaries.power = {
      continuousMax: fraction(1, 100),
      damageAt: fraction(1, 20),
    };
    input.elements[2].operatingProfile!.boundaries.power = {
      continuousMax: fraction(1, 100),
      damageAt: fraction(1, 20),
    };
    const assessment = assessOperatingPoint(input, result);
    expect(assessment.status).toBe('damage');
    expect(assessment.components.find((c) => c.componentId === 'R')?.value).toEqual(
      fraction(529, 9000),
    );
    expect(
      assessment.components.find((c) => c.componentId === 'D' && c.reason === 'power')?.value,
    ).toEqual(fraction(253, 2250));
    expect(
      assessOperatingPoint({ ...input, elements: [...input.elements].reverse() }, result),
    ).toEqual(assessment);
  });
  it('B12 computes branch resistors as part of sharing, without using current ratings as a limiter', () => {
    const input = circuit([
      element('V', 'dc-voltage-source', 'p', 'g', 3),
      element('R1', 'resistor', 'p', 'a', 10),
      element('R2', 'resistor', 'p', 'b', 10),
      element('D1', 'diode', 'a', 'g', 0.7),
      element('D2', 'diode', 'b', 'g', 0.7),
    ]);
    input.elements[3].operatingProfile!.diodeThresholdV = fraction(13, 20);
    input.elements[4].operatingProfile!.diodeThresholdV = fraction(3, 4);
    const result = component(input);
    expect(result.branchCurrents.D1).toEqual(fraction(3, 50));
    expect(result.branchCurrents.D2).toEqual(fraction(11, 200));
    expect(q.sub(result.branchCurrents.D1, result.branchCurrents.D2)).toEqual(fraction(1, 200));
    input.elements[3].operatingProfile!.boundaries.forwardCurrent = {
      continuousMax: fraction(1, 1000),
      damageAt: fraction(1, 500),
    };
    expect(component(input).branchCurrents.D1).toEqual(result.branchCurrents.D1);
  });
  it('B13 preserves textbook teaching values unless component characteristics are explicitly requested', () => {
    const input = series(1000, 5);
    expect(analyzeOperatingCircuit(input).result.provenance?.physicalModel).toBe('textbook');
    expect(
      analyzeOperatingCircuit(input, { physicalModel: 'component' }).result.provenance
        ?.physicalModel,
    ).toBe('component');
  });
  it('B16 never confirms a boundary crossed only by arithmetic uncertainty', () => {
    const input = series(3),
      result = component(input);
    result.branchCurrents.D = {
      ...fraction(1, 10),
      approximation: { reason: 'operation-limit', policy: 'dc-budget-1', absoluteError: 0.001 },
    };
    expect(assessOperatingPoint(input, result).status).toBe('overload');
    result.branchCurrents.D = {
      ...fraction(1, 20),
      approximation: { reason: 'operation-limit', policy: 'dc-budget-1', absoluteError: 0.001 },
    };
    expect(assessOperatingPoint(input, result).status).toBe('unverified');
  });
  it('B17 preserves explicit characteristics and versions as model input and provenance', () => {
    const input = series(1000, 5),
      initial = analyzeOperatingCircuit(input);
    input.elements[0].explicitCharacteristics = true;
    input.elements[0].operatingProfile!.sourceResistanceOhm = fraction(20);
    const changed = analyzeOperatingCircuit(input);
    expect(changed.result.provenance?.physicalModel).toBe('component');
    expect(changed.result.provenance?.profileRevision).not.toBe(
      initial.result.provenance?.profileRevision,
    );
    expect(changed.assessment.status).toBe('normal');
  });
  it.each(['sourceResistanceOhm', 'diodeOnResistanceOhm', 'diodeThresholdV'] as const)(
    'does not promote approximate %s profile inputs to exact solutions',
    (key) => {
      const input = series(1000),
        profile =
          key === 'sourceResistanceOhm'
            ? input.elements[0].operatingProfile!
            : input.elements[2].operatingProfile!;
      profile[key] = {
        ...profile[key]!,
        approximation: { reason: 'operation-limit', policy: 'dc-budget-1', absoluteError: 0.01 },
      };
      const result = component(input);
      expect(result.solution).toBe('unverified');
      expect(result.status).toBe('error');
      expect(result.branchCurrents.D).toBeUndefined();
    },
  );
});
