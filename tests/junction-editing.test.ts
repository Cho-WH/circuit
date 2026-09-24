import { describe, expect, it } from 'vitest';
import { emptyDocument, validateDocument, type CircuitDocument } from '../src/domain';
import { createComponent, wirePoints } from '../src/component-library';
import { compactWirePoints } from '../src/wire-geometry';
import { createHistory, executeCommand, previewCommand, insertionCandidates, undo, redo, type Command } from '../src/editor';
import { compileCircuit } from '../src/connectivity';

function fixture(branch = true): CircuitDocument {
  const doc = emptyDocument('junction-editing');
  doc.junctions = [
    { id: 'L', position: { x: 0, y: 200 } }, { id: 'M', position: { x: 200, y: 200 } },
    { id: 'R', position: { x: 400, y: 200 } }, { id: 'T', position: { x: 200, y: 0 } },
    { id: 'unrelated', position: { x: 800, y: 800 } },
  ];
  doc.wires = [['left', 'L', 'M'], ['right', 'M', 'R'], ...(branch ? [['branch', 'M', 'T']] : [])]
    .map(([id, start, end]) => ({ id, start: { kind: 'junction', id: start }, end: { kind: 'junction', id: end }, waypoints: [] }));
  return doc;
}
function apply(doc: CircuitDocument, command: Command) {
  const original = structuredClone(doc), result = executeCommand(createHistory(doc), command);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const next = result.history.present;
  expect(validateDocument(next).ok).toBe(true);
  expect(doc).toEqual(original);
  expect(previewCommand(doc, command)).toEqual({ ok: true, document: next });
  expect(undo(result.history).present).toEqual(doc);
  expect(redo(undo(result.history)).present).toEqual(next);
  return next;
}
const remove = (doc: CircuitDocument, ids: string[]) => apply(doc, { type: 'DeleteElements', ids });
const insertion = (): Command => ({ type: 'InsertComponentOnWire', component: createComponent('resistor', 'R1', { x: 200, y: 200 }), wireId: 'left', segment: 0, newWireId: 'added' });
const nets = (doc: CircuitDocument) => compileCircuit(doc).circuit.endpointToNet;

describe('local junction lifecycle', () => {
  it('contracts the former branch and removes its isolated end while preserving unrelated nodes', () => {
    const next = remove(fixture(), ['branch']);
    expect(next.junctions.map(j => j.id)).toEqual(['L', 'R', 'unrelated']);
    expect(next.wires).toEqual([{ id: 'left', start: { kind: 'junction', id: 'L' }, end: { kind: 'junction', id: 'R' }, waypoints: [] }]);
    expect(nets(next).L).toBe(nets(next).R);
  });
  it('preserves a branch, then its open end, then removes the isolated endpoints', () => {
    const doc = fixture();
    doc.junctions.push({ id: 'B', position: { x: 200, y: 400 } });
    doc.wires.push({ id: 'down', start: { kind: 'junction', id: 'M' }, end: { kind: 'junction', id: 'B' }, waypoints: [] });
    const branch = remove(doc, ['branch']);
    expect(branch.junctions.some(j => j.id === 'M')).toBe(true);
    const open = remove(branch, ['left', 'right']);
    expect(open.junctions.map(j => j.id)).toEqual(['M', 'unrelated', 'B']);
    expect(remove(open, ['down']).junctions.map(j => j.id)).toEqual(['unrelated']);
  });
  it.each(['reference', 'annotation'])('preserves the %s anchor even after every attached wire is deleted', kind => {
    const doc = fixture();
    if (kind === 'reference') doc.referenceNode = { kind: 'junction', id: 'M' };
    else doc.annotations = [{ id: 'note', kind: 'note', anchor: { kind: 'junction', id: 'M' }, content: 'A', visibility: 'always' }];
    expect(remove(doc, ['branch']).junctions.some(j => j.id === 'M')).toBe(true);
    expect(remove(doc, ['left', 'right', 'branch']).junctions.map(j => j.id)).toEqual(['M', 'unrelated']);
  });
  it.each([['M'], ['M', 'branch'], ['unrelated']])('rejects manual junction deletion atomically: %j', (...ids) => {
    const doc = fixture(), history = createHistory(doc), command: Command = { type: 'DeleteElements', ids };
    const result = executeCommand(history, command);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_COMMAND' }] });
    expect(previewCommand(doc, command)).toEqual(result);
    expect(history.present).toEqual(doc);
    expect(history.past).toHaveLength(0);
  });
  it('preserves bends when joining the two remaining routes', () => {
    const doc = fixture();
    doc.wires[0].waypoints = [{ x: 0, y: 100 }, { x: 200, y: 100 }];
    const expected = compactWirePoints([...wirePoints(doc, doc.wires[0]), ...wirePoints(doc, doc.wires[1]).slice(1)]);
    const next = remove(doc, ['branch']);
    expect(wirePoints(next, next.wires[0])).toEqual(expected);
  });
});

describe('insertion through redundant junctions', () => {
  it('uses the same normalized route for discovery, preview and commit', () => {
    const doc = fixture(false), original = structuredClone(doc);
    const candidates = insertionCandidates(doc, { x: 200, y: 200 });
    expect(candidates).toEqual([{ wireId: 'left', segment: 0, position: { x: 200, y: 200 }, rotation: 0 }]);
    expect(insertionCandidates(doc, { x: 200, y: 200 }, 'right')).toEqual(candidates);
    expect(doc).toEqual(original);
    const next = apply(doc, insertion());
    expect(next.junctions.map(j => j.id)).toEqual(['L', 'R', 'T', 'unrelated']);
    expect(next.wires.map(w => w.id)).toEqual(['left', 'added']);
    expect(nets(next).L).toBe(nets(next)['R1.a']);
    expect(nets(next).R).toBe(nets(next)['R1.b']);
    expect(nets(next).L).not.toBe(nets(next).R);
  });
  it('commits normalization only to the selected route', () => {
    const doc = fixture(false);
    doc.junctions.push({ id: 'U', position: { x: 800, y: 0 } }, { id: 'V', position: { x: 900, y: 0 } });
    doc.wires.push(...[['u', 'T', 'U'], ['v', 'U', 'V']].map(([id, start, end]) => ({ id, start: { kind: 'junction' as const, id: start }, end: { kind: 'junction' as const, id: end }, waypoints: [] })));
    const next = apply(doc, insertion());
    expect(next.junctions.find(j => j.id === 'U')).toEqual(doc.junctions.find(j => j.id === 'U'));
    expect(next.wires.filter(w => ['u', 'v'].includes(w.id))).toEqual(doc.wires.slice(2));
  });
  it.each(['branch', 'corner', 'anchor'])('rejects %s placement atomically', kind => {
    const doc = fixture(kind === 'branch'), original = structuredClone(doc);
    if (kind === 'corner') doc.junctions.find(j => j.id === 'R')!.position = { x: 200, y: 400 };
    if (kind === 'anchor') doc.referenceNode = { kind: 'junction', id: 'M' };
    const before = structuredClone(doc);
    expect(insertionCandidates(doc, { x: 200, y: 200 }).every(c => c.reason)).toBe(true);
    const history = createHistory(doc);
    expect(executeCommand(history, insertion()).ok).toBe(false);
    expect(history.present).toEqual(before);
    expect(doc.documentId).toBe(original.documentId);
  });
});
