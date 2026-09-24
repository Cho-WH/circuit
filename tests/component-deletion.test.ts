import { describe, expect, it } from 'vitest';
import { emptyDocument, validateDocument, documentMigrator, createDocumentIdAllocator, type CircuitDocument, type ComponentType } from '../src/domain';
import { createComponent, terminalPosition, wirePoints, endpointPosition } from '../src/component-library';
import { createHistory, executeCommand, previewCommand, undo, redo, insertionCandidates } from '../src/editor';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { serializeDocument, parseDocument } from '../src/persistence';
import { exportSvg } from '../src/export';
import { compactWirePoints, orthogonalRoute } from '../src/wire-geometry';
import source from '../fixtures/ux/wire-editing.json';

function fixture(): CircuitDocument {
  const doc = emptyDocument('delete-component');
  doc.components = [createComponent('resistor', 'R1', { x: 200, y: 200 })];
  doc.junctions = [
    { id: 'L', position: { x: 0, y: 100 } },
    { id: 'R', position: { x: 400, y: 300 } },
    { id: 'T', position: { x: 80, y: 0 } },
  ];
  doc.wires = [
    { id: 'W1', start: { kind: 'junction', id: 'L' }, end: { kind: 'terminal', id: 'R1.a' }, waypoints: [{ x: 40, y: 100 }, { x: 40, y: 200 }] },
    { id: 'W2', start: { kind: 'terminal', id: 'R1.b' }, end: { kind: 'junction', id: 'R' }, waypoints: [{ x: 320, y: 200 }, { x: 320, y: 300 }] },
    { id: 'branch', start: { kind: 'terminal', id: 'R1.a' }, end: { kind: 'junction', id: 'T' }, waypoints: [{ x: 156, y: 0 }] },
  ];
  return doc;
}
function remove(doc: CircuitDocument, ids = ['R1']) {
  const result = executeCommand(createHistory(doc), { type: 'DeleteElements', ids });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(validateDocument(result.history.present).ok).toBe(true);
  return result.history;
}
const nets = (doc: CircuitDocument) => compileCircuit(doc).circuit.endpointToNet;

describe('component deletion preserves wiring locally', () => {
  it('preserves routes and actual branches while dissolving the redundant joining point', () => {
    const doc = fixture(), before = structuredClone(doc), history = remove(doc), next = history.present;
    expect(next.components).toEqual([]);
    for (const wire of doc.wires.filter(w => w.id !== 'W2')) {
      const retained = next.wires.find(w => w.id === wire.id)!;
      expect(wirePoints(next, retained)).toEqual(wirePoints(doc, wire));
      expect(retained.waypoints).toEqual(wire.waypoints);
    }
    expect(next.wires).toHaveLength(doc.wires.length);
    expect(next.junctions).toHaveLength(doc.junctions.length + 1);
    expect(wirePoints(next, next.wires.find(w => w.id === 'W2')!)).toEqual([
      { x: 156, y: 200 }, { x: 320, y: 200 }, { x: 320, y: 300 }, { x: 400, y: 300 },
    ]);
    expect(nets(next).L).toBe(nets(next).R);
    expect(nets(next).L).toBe(nets(next).T);
    expect(doc).toEqual(before);
    expect(previewCommand(doc, { type: 'DeleteElements', ids: ['R1'] })).toEqual({ ok: true, document: next });
    expect(history.past).toHaveLength(1);
    expect(undo(history).present).toEqual(doc);
    expect(redo(undo(history)).present).toEqual(next);
    expect(parseDocument(serializeDocument(next))).toMatchObject({ ok: true, document: next });
    expect(exportSvg(next).match(/<path d="[^"]+"/g)).toContain('<path d="M156 200 L320 200 L320 300 L400 300"');
  });

  it.each<ComponentType>(['resistor', 'resistive-load', 'switch', 'ammeter', 'voltmeter', 'dc-voltage-source'])('applies the same two-terminal rule to %s at every rotation', type => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const doc = fixture(), component = createComponent(type, 'C', { x: 200, y: 200 });
      component.rotation = rotation;
      doc.components = [component];
      doc.wires[0].end.id = component.terminals[0].id;
      doc.wires[1].start.id = component.terminals[1].id;
      doc.wires[2].start.id = component.terminals[0].id;
      const next = remove(doc, ['C']).present;
      expect(wirePoints(next, next.wires.find(w => w.id === 'W2')!)).toEqual(compactWirePoints([
        ...orthogonalRoute(terminalPosition(component, 0), terminalPosition(component, 1), 'VH'),
        ...wirePoints(doc, doc.wires[1]).slice(1),
      ]));
      expect(next.junctions).toHaveLength(doc.junctions.length + 1);
      expect(nets(next).L).toBe(nets(next).R);
    }
  });

  it('preserves terminal annotations and reference position through the same endpoint remapping', () => {
    const doc = fixture();
    doc.referenceNode = { kind: 'terminal', id: 'R1.b' };
    doc.annotations = [
      { id: 'note', kind: 'note', anchor: { kind: 'terminal', id: 'R1.a' }, content: 'A', visibility: 'always' },
      { id: 'remove-note', kind: 'note', anchor: { kind: 'terminal', id: 'R1.b' }, content: 'B', visibility: 'always' },
    ];
    const next = remove(doc, ['R1', 'remove-note']).present;
    expect(next.annotations).toHaveLength(1);
    expect(next.annotations[0]).toMatchObject({ content: 'A', anchor: next.wires[0].end });
    expect(endpointPosition(next, next.annotations[0].anchor!)).toEqual(terminalPosition(doc.components[0], 0));
    expect(next.referenceNode).toEqual(next.wires[1].start);
    expect(endpointPosition(next, next.referenceNode!)).toEqual(endpointPosition(doc, doc.referenceNode));
  });

  it('retains an open end when only one side has a surviving wire', () => {
    const doc = fixture();
    const next = remove(doc, ['R1', 'W2', 'branch']).present;
    expect(next.wires.some(w => w.id === 'W2' || w.id === 'branch')).toBe(false);
    expect(next.wires).toHaveLength(1);
    expect(wirePoints(next, next.wires[0])).toEqual([{ x: 0, y: 100 }, { x: 40, y: 100 }, { x: 40, y: 200 }, { x: 244, y: 200 }]);
    expect(next.junctions).toHaveLength(doc.junctions.length + 1); // Only the open end remains.
    expect(nets(next).L).not.toBe(nets(next).R);
  });

  it('leaves no artifacts when an isolated part or an entire selection is deleted', () => {
    const doc = fixture(); doc.wires = []; doc.junctions = [];
    doc.referenceNode = { kind: 'terminal', id: 'R1.a' };
    doc.annotations = [{ id: 'note', kind: 'note', anchor: doc.referenceNode, content: 'A', visibility: 'always' }];
    expect(remove(doc).present).toMatchObject({ components: [], wires: [], junctions: [], annotations: [], referenceNode: null });
    const all = fixture();
    expect(remove(all, [...all.components, ...all.wires, ...all.junctions].map(x => x.id)).present)
      .toMatchObject({ components: [], wires: [], junctions: [] });
  });

  it('honors explicit junction deletion, including its wires and anchors', () => {
    const doc = fixture();
    doc.referenceNode = { kind: 'junction', id: 'L' };
    doc.annotations = [{ id: 'note', kind: 'note', anchor: doc.referenceNode, content: 'A', visibility: 'always' }];
    const next = remove(doc, ['R1', 'L']).present;
    expect(next.wires.some(w => w.id === 'W1')).toBe(false);
    expect(next.junctions.some(j => j.id === 'L')).toBe(false);
    expect(next.annotations).toEqual([]); expect(next.referenceNode).toBeNull();
    expect(nets(next).T).toBe(nets(next).R);
  });

  it('bridges adjacent selected parts atomically and independently of selection order', () => {
    const doc = fixture(), second = createComponent('resistor', 'R2', { x: 400, y: 200 });
    doc.components.push(second);
    doc.wires[1].end = { kind: 'terminal', id: 'R2.a' };
    doc.wires.push({ id: 'tail', start: { kind: 'terminal', id: 'R2.b' }, end: { kind: 'junction', id: 'R' }, waypoints: [] });
    const next = remove(doc, ['R1', 'R2']).present;
    expect(next).toEqual(remove(doc, ['R2', 'R1', 'R2']).present);
    expect(nets(next).L).toBe(nets(next).R);
    expect(next.wires).toHaveLength(3);
    expect(next.junctions).toHaveLength(doc.junctions.length + 1);
    expect(wirePoints(next, next.wires.find(w => w.id === 'W2')!)).toEqual(compactWirePoints([
      terminalPosition(doc.components[0], 0), ...wirePoints(doc, doc.wires[1]),
      ...wirePoints(doc, doc.wires.find(w => w.id === 'tail')!),
    ]));
  });

  it('does not connect coincident endpoints or simplify unrelated/legacy routes', () => {
    const doc = fixture();
    doc.junctions.push({ id: 'coincident', position: terminalPosition(doc.components[0], 0) });
    doc.wires[0].waypoints = [{ x: 51, y: 37 }];
    const next = remove(doc).present;
    expect(nets(next).coincident).not.toBe(nets(next).L);
    expect(wirePoints(next, next.wires[0])).toEqual(wirePoints(doc, doc.wires[0]));
  });

  it('uses explicit local terminal positions for the bridge without moving old wires', () => {
    const doc = fixture();
    doc.components[0].terminals[0].localPosition = { x: -25, y: -10 };
    doc.components[0].terminals[1].localPosition = { x: 35, y: 20 };
    const next = remove(doc).present, path = wirePoints(next, next.wires.find(w => w.id === 'W2')!);
    expect(path).toEqual([{ x: 175, y: 190 }, { x: 175, y: 220 }, { x: 235, y: 220 }, { x: 320, y: 200 }, { x: 320, y: 300 }, { x: 400, y: 300 }]);
    expect(wirePoints(next, next.wires[0])).toEqual(wirePoints(doc, doc.wires[0]));
  });

  it.each([3, 4])('keeps the external nets of unsupported %s-terminal parts separate while joining wires on the same terminal', count => {
    const doc = fixture();
    for (let i = 2; i < count; i++) {
      doc.components[0].terminals.push({ id: `extra${i}`, role: `extra${i}`, localPosition: { x: 0, y: 60 * i } });
      doc.junctions.push({ id: `outer${i}`, position: { x: 400, y: 200 + 60 * i } });
      doc.wires.push({ id: `wire${i}`, start: { kind: 'terminal', id: `extra${i}` }, end: { kind: 'junction', id: `outer${i}` }, waypoints: [] });
    }
    const next = remove(doc).present;
    expect(next.wires).toHaveLength(doc.wires.length - 1);
    expect(nets(next).L).toBe(nets(next).T);
    expect(nets(next).L).not.toBe(nets(next).R);
    expect(new Set(['L', 'R', ...Array.from({ length: count - 2 }, (_, i) => `outer${i + 2}`)].map(id => nets(next)[id])).size).toBe(count);
  });

  it('allocates deterministic fresh IDs across every entity kind and never reuses explicitly deleted IDs', () => {
    const doc = fixture();
    doc.components.push(createComponent('resistor', 'J1', { x: 500, y: 500 }));
    doc.components[1].terminals[0].id = 'J2';
    doc.annotations.push({ id: 'J3', kind: 'note', anchor: null, position: { x: 0, y: 0 }, content: '', visibility: 'always' });
    doc.junctions.push({ id: 'W3', position: { x: 700, y: 500 } });
    doc.referenceNode = { kind: 'terminal', id: 'R1.a' };
    doc.annotations.push({ id: 'anchor', kind: 'note', anchor: { kind: 'terminal', id: 'R1.b' }, content: '', visibility: 'always' });
    const next = remove(doc, ['R1', 'W1']).present;
    expect(next.junctions.slice(-2).map(j => j.id)).toEqual(['J4', 'J5']);
    expect(next.wires.at(-1)?.id).toBe('W4');
    const allocate = createDocumentIdAllocator(doc);
    expect([allocate('J'), allocate('J')]).toEqual(['J4', 'J5']);
    expect(remove(doc, ['R1', 'W1']).present).toEqual(next);
  });

  it('restores the series circuit current when an inserted resistor is deleted', () => {
    const doc = documentMigrator.migrate(source), component = createComponent('resistor', 'R2', { x: 300, y: 450 });
    component.properties.resistanceOhm = 6;
    const target = insertionCandidates(doc, component.position)[0];
    const inserted = executeCommand(createHistory(doc), { type: 'InsertComponentOnWire', component, ...target, newWireId: 'W3' });
    expect(inserted.ok).toBe(true); if (!inserted.ok) return;
    const next = remove(inserted.history.present, ['R2']).present;
    expect(next.junctions).toEqual(doc.junctions);
    expect(next.wires).toHaveLength(doc.wires.length);
    for (const wire of doc.wires) expect(compactWirePoints(wirePoints(next, next.wires.find(w => w.id === wire.id)!)))
      .toEqual(compactWirePoints(wirePoints(doc, wire)));
    expect(solveCircuit(compileCircuit(inserted.history.present).circuit).branchCurrents.R1).toBeCloseTo(1);
    expect(solveCircuit(compileCircuit(next).circuit).branchCurrents.R1).toBeCloseTo(3);
    expect(solveCircuit(compileCircuit(next).circuit).diagnostics).toEqual(solveCircuit(compileCircuit(doc).circuit).diagnostics);
  });

  it('still rejects forbidden or missing targets without partial changes', () => {
    const doc = fixture(); doc.activity = { allowedCommands: ['MoveComponents'], revealSteps: [] };
    const before = structuredClone(doc);
    expect(executeCommand(createHistory(doc), { type: 'DeleteElements', ids: ['R1'] })).toMatchObject({ ok: false, diagnostics: [{ code: 'COMMAND_NOT_ALLOWED' }] });
    expect(doc).toEqual(before);
    doc.activity = null;
    expect(executeCommand(createHistory(doc), { type: 'DeleteElements', ids: ['R1', 'missing'] })).toMatchObject({ ok: false, diagnostics: [{ code: 'COMMAND_TARGET_NOT_FOUND' }] });
    expect(doc.components).toHaveLength(1); expect(doc.junctions).toHaveLength(3);
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])('joins a simple chain without new nodes regardless of wire direction (%s, %s)', (reverseLeft, reverseRight) => {
    const doc = fixture(); doc.wires = doc.wires.slice(0, 2);
    for (const [i, reverse] of [reverseLeft, reverseRight].entries()) if (reverse) {
      const wire = doc.wires[i];
      [wire.start, wire.end] = [wire.end, wire.start]; wire.waypoints.reverse();
    }
    const next = remove(doc).present;
    expect(next.junctions).toEqual(doc.junctions);
    expect(next.wires).toHaveLength(1);
    expect(next.wires[0].id).toBe('W1');
    const path = wirePoints(next, next.wires[0]);
    if (next.wires[0].start.id === 'R') path.reverse();
    expect(path).toEqual([{ x: 0, y: 100 }, { x: 40, y: 100 }, { x: 40, y: 200 }, { x: 320, y: 200 }, { x: 320, y: 300 }, { x: 400, y: 300 }]);
  });

  it('preserves a closed loop and its bends with the one endpoint required by the document model', () => {
    const doc = fixture(); doc.junctions = [];
    doc.wires = [{ id: 'loop', start: { kind: 'terminal', id: 'R1.a' }, end: { kind: 'terminal', id: 'R1.b' }, waypoints: [{ x: 156, y: 300 }, { x: 244, y: 300 }] }];
    const next = remove(doc).present;
    expect(next.wires).toHaveLength(1); expect(next.junctions).toHaveLength(1);
    expect(next.wires[0].start).toEqual(next.wires[0].end);
    const path = wirePoints(next, next.wires[0]);
    expect(path[0]).toEqual(path.at(-1));
    expect(path).toContainEqual({ x: 156, y: 300 }); expect(path).toContainEqual({ x: 244, y: 300 });
  });
});
