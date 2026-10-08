import { createComponent } from '../src/component-library';
import { examples } from '../src/fixtures';
import { layoutExample } from '../src/app/examples';

export function meterCircuit() {
  const doc = layoutExample(examples.find((e) => e.id === 'FIX-02')!.document);
  doc.documentId = 'meter-readout-check';
  doc.title = '계기값 표시 확인';
  const a = createComponent('ammeter', 'A1', { x: 320, y: 160 }, 'A_1');
  const v = createComponent('voltmeter', 'M1', { x: 500, y: 320 }, 'M_1');
  const s = createComponent('switch', 'S1', { x: 360, y: 440 }, 'S_1');
  s.properties.state = 'closed';
  doc.components.push(a, v, s);
  const addWire = (id: string, start: string, end: string) =>
    doc.wires.push({
      id,
      start: { kind: 'terminal', id: start },
      end: { kind: 'terminal', id: end },
      waypoints: [],
    });
  const first = doc.wires.find((w) => w.id === 'W1')!;
  const firstEnd = first.end;
  first.end = { kind: 'terminal', id: a.terminals[0].id };
  addWire('A-out', a.terminals[1].id, firstEnd.id);
  addWire('M-a', v.terminals[0].id, 'R1.a');
  addWire('M-b', v.terminals[1].id, 'R1.b');
  const last = doc.wires.find((w) => w.id === 'W4')!;
  const lastEnd = last.end;
  last.end = { kind: 'terminal', id: s.terminals[0].id };
  addWire('S-out', s.terminals[1].id, lastEnd.id);
  const positions = {
    V1: { x: 240, y: 340 },
    R1: { x: 540, y: 180 },
    R2: { x: 780, y: 180 },
    A1: { x: 360, y: 180 },
    M1: { x: 540, y: 320 },
    S1: { x: 540, y: 480 },
  };
  for (const c of doc.components) c.position = positions[c.id as keyof typeof positions];
  s.rotation = 180;
  doc.junctions[0].position = { x: 660, y: 180 };
  for (const w of doc.wires) w.waypoints = [];
  first.waypoints = [{ x: 240, y: 180 }];
  last.waypoints = [
    { x: 900, y: 180 },
    { x: 900, y: 480 },
  ];
  doc.wires.find((w) => w.id === 'S-out')!.waypoints = [{ x: 240, y: 480 }];
  return doc;
}
