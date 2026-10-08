import { describe, expect, it } from 'vitest';
import { emptyDocument, validateDocument } from '../src/domain';
import { createComponent, wirePoints } from '../src/component-library';
import { copySelection, createHistory, executeCommand, undo, redo } from '../src/editor';
import {
  copyAt,
  copyOverlapsComponents,
  elementsInSelection,
  payloadDocument,
} from '../src/app/copy-placement';
import { parseDocument, serializeDocument } from '../src/persistence';

function fixture() {
  const doc = emptyDocument('copy');
  doc.components = [
    createComponent('diode', 'D', { x: 200, y: 200 }),
    createComponent('resistor', 'R', { x: 600, y: 200 }),
  ];
  doc.junctions = [{ id: 'J', position: { x: 400, y: 400 } }];
  doc.wires = [
    {
      id: 'W1',
      start: { kind: 'terminal', id: 'D.b' },
      end: { kind: 'junction', id: 'J' },
      waypoints: [{ x: 400, y: 200 }],
    },
    {
      id: 'W2',
      start: { kind: 'junction', id: 'J' },
      end: { kind: 'terminal', id: 'R.a' },
      waypoints: [{ x: 556, y: 400 }],
    },
  ];
  return doc;
}
let sequence = 0;
const id = (prefix: string) => `${prefix}-${++sequence}`;

describe('selection copy geometry and connectivity', () => {
  it('selects in either direction and includes all junctions and routes of a complete circuit', () => {
    const doc = fixture();
    expect(elementsInSelection(doc, { x: 0, y: 0 }, { x: 800, y: 500 })).toEqual([
      'D',
      'R',
      'J',
      'W1',
      'W2',
    ]);
    expect(elementsInSelection(doc, { x: 800, y: 500 }, { x: 0, y: 0 })).toEqual([
      'D',
      'R',
      'J',
      'W1',
      'W2',
    ]);
    expect(elementsInSelection(doc, { x: 100, y: 100 }, { x: 300, y: 300 })).toEqual(['D']);
  });
  it('copies only chosen wire ends as detached junctions without referring to source terminals', () => {
    const doc = fixture();
    const payload = copySelection(doc, ['W1'], id, { x: 0, y: 0 });
    expect(payload.components).toHaveLength(0);
    expect(payload.junctions).toHaveLength(2);
    expect(payload.wires[0].start.kind).toBe('junction');
    expect(payload.wires[0].end.kind).toBe('junction');
    expect(wirePoints(payloadDocument(payload), payload.wires[0])).toEqual(
      wirePoints(doc, doc.wires[0]),
    );
    expect(validateDocument(payloadDocument(payload)).ok).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('D.b');
  });
  it('keeps internal topology, properties and relative routes through translation, paste, undo and storage', () => {
    const doc = fixture();
    const ids = elementsInSelection(doc, { x: 0, y: 0 }, { x: 800, y: 500 });
    const copied = copySelection(doc, ids, id, { x: 0, y: 0 });
    const placed = copyAt(copied, { x: 1000, y: 800 });
    expect(copied.components[0].position).toEqual(doc.components[0].position);
    const result = executeCommand(createHistory(doc), { type: 'Paste', ...placed });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.history.past).toHaveLength(1);
    expect(result.history.present.components).toHaveLength(4);
    expect(placed.components[0].operatingProfile).toEqual(doc.components[0].operatingProfile);
    expect(placed.wires[0].end.id).toBe(placed.wires[1].start.id);
    expect(placed.wires[0].end.id).not.toBe('J');
    expect(undo(result.history).present).toEqual(doc);
    expect(redo(undo(result.history)).present).toEqual(result.history.present);
    expect(parseDocument(serializeDocument(result.history.present)).ok).toBe(true);
  });
  it('rejects overlapping groups, including a copied wire crossing an existing component body', () => {
    const doc = fixture(),
      payload = copySelection(doc, ['D', 'R', 'J'], id, { x: 0, y: 0 });
    expect(copyOverlapsComponents(doc, payload)).toBe(true);
    expect(copyOverlapsComponents(doc, copyAt(payload, { x: 1200, y: 1000 }))).toBe(false);
    const wire = copySelection(doc, ['W1'], id, { x: 0, y: 0 });
    const target = emptyDocument();
    target.components = [createComponent('resistor', 'T', { x: 350, y: 200 })];
    expect(copyOverlapsComponents(target, wire)).toBe(true);
  });
  it('moves a complete selection including junctions and bent routes by one shared offset', () => {
    const doc = fixture();
    const positions = Object.fromEntries(
      [...doc.components, ...doc.junctions].map((c) => [
        c.id,
        { x: c.position.x + 100, y: c.position.y + 60 },
      ]),
    );
    const result = executeCommand(createHistory(doc), { type: 'MoveComponents', positions });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let i = 0; i < doc.wires.length; i++)
      expect(wirePoints(result.history.present, result.history.present.wires[i])).toEqual(
        wirePoints(doc, doc.wires[i]).map((p) => ({ x: p.x + 100, y: p.y + 60 })),
      );
    const same = executeCommand(result.history, { type: 'MoveComponents', positions });
    expect(same.ok && same.history).toBe(result.history);
  });
});
