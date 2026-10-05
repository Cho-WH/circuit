import { describe, expect, it } from 'vitest';
import { emptyDocument, operatingProfileFor, validateDocument } from '../src/domain';
import { createComponent, endpointName, symbolMarkup, terminalPosition } from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import { parseDocument, serializeDocument } from '../src/persistence';
import * as q from '../src/rational';

describe('diode document and component contracts', () => {
  it('uses explicit A/K roles for polarity and geometry even after reordering terminals', () => {
    const document = emptyDocument('diode-polarity');
    const diode = createComponent('diode', 'D1', { x: 200, y: 120 });
    diode.terminals.reverse();
    diode.rotation = 90;
    document.components.push(diode);
    const compiled = compileCircuit(document).circuit;
    expect(compiled.elements[0]).toMatchObject({
      type: 'diode', a: compiled.endpointToNet['D1.a'], b: compiled.endpointToNet['D1.b'], value: q.rational(7n, 10n),
    });
    expect(terminalPosition(diode, 1)).toEqual({ x: 200, y: 76 });
    expect(terminalPosition(diode, 0)).toEqual({ x: 200, y: 164 });
    expect(endpointName(document, 'D1.a')).toBe('D1 · A 단자');
    expect(endpointName(document, 'D1.b')).toBe('D1 · K 단자');
    expect(symbolMarkup(diode)).toContain('>A</text>');
    expect(symbolMarkup(diode)).toContain('>K</text>');
  });

  it('round-trips profile references and fixed exact component differences without computed state', () => {
    const document = emptyDocument('diode-profile');
    const diode = createComponent('diode', 'D1', { x: 0, y: 0 });
    diode.properties.diodeThresholdV = q.store(q.rational(13n, 20n));
    diode.properties.diodeOnResistanceOhm = q.store(q.rational(5n, 2n));
    document.components.push(diode);
    const serialized = serializeDocument(document);
    expect(parseDocument(serialized)).toEqual({ ok: true, document });
    expect(compileCircuit(document).circuit.elements[0].operatingProfile).toMatchObject({
      id: 'edu-diode', revision: 1, diodeThresholdV: q.rational(13n, 20n), diodeOnResistanceOhm: q.rational(5n, 2n),
    });
    expect(compileCircuit(document).circuit.elements[0].explicitCharacteristics).toBe(true);
    expect(serialized).not.toMatch(/branchCurrents|assessment|damaged/);
    expect(validateDocument({ ...document, version: 5 }).ok).toBe(false);
    expect(validateDocument({ ...document, version: 7 }).ok).toBe(false);
  });

  it('rejects ambiguous polarity, unknown profile versions and nonpositive slopes', () => {
    for (const modify of [
      (diode: ReturnType<typeof createComponent>) => { diode.terminals[1].role = 'anode'; },
      (diode: ReturnType<typeof createComponent>) => { diode.operatingProfile = { id: 'edu-source', revision: 1 }; },
      (diode: ReturnType<typeof createComponent>) => { diode.properties.diodeOnResistanceOhm = q.store(0); },
      (diode: ReturnType<typeof createComponent>) => { diode.properties.diodeThresholdV = q.store(-1); },
    ]) {
      const document = emptyDocument('invalid-diode');
      const diode = createComponent('diode', 'D1', { x: 0, y: 0 });
      modify(diode);
      document.components.push(diode);
      expect(validateDocument(document).ok).toBe(false);
    }
    const document = emptyDocument('invalid-version');
    document.components.push(createComponent('diode', 'D1', { x: 0, y: 0 }));
    const json = JSON.parse(JSON.stringify(document));
    json.components[0].operatingProfile.revision = 2;
    expect(validateDocument(json).ok).toBe(false);
  });

  it('keeps revision-1 educational boundaries explicit and independent for each quantity', () => {
    for (const type of ['dc-voltage-source', 'diode', 'resistor', 'resistive-load'] as const) {
      const component = createComponent(type, 'C1', { x: 0, y: 0 });
      const profile = operatingProfileFor(component)!;
      const implicit = { ...component }; delete implicit.operatingProfile;
      expect(operatingProfileFor(implicit)).toEqual(profile);
      for (const bounds of Object.values(profile.boundaries)) {
        expect(q.compare(bounds.continuousMax, 0)).toBeGreaterThanOrEqual(0);
        expect(q.compare(bounds.damageAt, bounds.continuousMax)).toBeGreaterThan(0);
      }
    }
    const source = operatingProfileFor(createComponent('dc-voltage-source', 'V1', { x: 0, y: 0 }))!;
    const diode = operatingProfileFor(createComponent('diode', 'D1', { x: 0, y: 0 }))!;
    expect(source.sourceResistanceOhm).toEqual(q.from(1));
    expect(diode.diodeOnResistanceOhm).toEqual(q.from(2));
    expect(diode.boundaries.forwardCurrent).toEqual({ continuousMax: q.rational(1n, 5n), damageAt: q.rational(3n, 4n) });
  });
});
