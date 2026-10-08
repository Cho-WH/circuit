import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/domain';
import { createComponent, wirePoints } from '../src/component-library';
import { createHistory, executeCommands, undo, redo } from '../src/editor';
import { referenceCommands } from '../src/app/reference-editing';
import { examples } from '../src/fixtures';
import { analyze } from '../src/app/analyze';
import { serializeDocument, parseDocument } from '../src/persistence';

describe('reference transactions', () => {
  const fixture = () => {
    const doc = emptyDocument('reference-wire');
    doc.components = [createComponent('dc-voltage-source', 'V1', { x: 100, y: 100 })];
    doc.junctions = [{ id: 'L', position: { x: 100, y: 400 } }, { id: 'R', position: { x: 700, y: 400 } }];
    doc.wires = [{ id: 'W1', start: { kind: 'junction', id: 'L' }, end: { kind: 'junction', id: 'R' }, waypoints: [] }];
    return doc;
  };
  it('splits a wire, cleans the former degree-two anchor, and roundtrips with undo/redo and current storage', () => {
    const doc = fixture();
    const placed = executeCommands(createHistory(doc), referenceCommands(doc, { kind: 'wire', wireId: 'W1', point: { x: 300, y: 400 } }));
    if (!placed.ok) throw new Error('placement failed');
    expect(placed.history.past).toHaveLength(1);
    const split = placed.history.present;
    expect(split.wires).toHaveLength(2);
    expect(undo(placed.history).present).toEqual(doc);
    expect(redo(undo(placed.history)).present).toEqual(split);
    const moved = executeCommands(placed.history, referenceCommands(split, { kind: 'endpoint', ref: { kind: 'terminal', id: 'V1.a' }, point: { x: 60, y: 100 } }));
    if (!moved.ok) throw new Error('move failed');
    expect(moved.history.present.junctions).toEqual(doc.junctions);
    expect(moved.history.present.wires).toHaveLength(1);
    expect(wirePoints(moved.history.present, moved.history.present.wires[0])).toEqual(wirePoints(doc, doc.wires[0]));
    const parsed = parseDocument(serializeDocument(split));
    expect(parsed.ok && parsed.document).toEqual(split);
  });
  it.each(['AddJunction', 'SetReference'])('rolls back the whole drop if %s is denied', denied => {
    const doc = fixture(); doc.activity = { allowedCommands: ['AddJunction', 'SetReference'].filter(c => c !== denied), revealSteps: [] };
    const history = createHistory(doc);
    const result = executeCommands(history, referenceCommands(doc, { kind: 'wire', wireId: 'W1', point: { x: 300, y: 400 } }));
    expect(result.ok).toBe(false);
    expect(history.present).toEqual(doc);
    expect(history.past).toHaveLength(0);
  });
  it.each(['a', 'b'])('restores bridge potentials without changing physical measurements in switch state %s', state => {
    const doc = structuredClone(examples.find(e => e.document.documentId === 'fix-14')!.document);
    doc.referenceNode = null;
    doc.components.find(c => c.type === 'switch')!.properties.state = state;
    const floating = analyze(doc).result;
    const referenced = { ...doc, referenceNode: { kind: 'terminal' as const, id: doc.components.find(c=>c.type==='dc-voltage-source')!.terminals.find(t=>t.role==='negative')!.id } }, grounded = analyze(referenced).result;
    expect(referenced.referenceNode).not.toBeNull();
    expect(grounded.branchCurrents).toEqual(floating.branchCurrents);
    expect(grounded.componentVoltages).toEqual(floating.componentVoltages);
    expect(Object.keys(grounded.nodeVoltages).length).toBeGreaterThan(0);
  });
});
