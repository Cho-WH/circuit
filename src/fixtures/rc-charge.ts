import { emptyDocument } from '../domain';
import { createComponent } from '../component-library';
import * as q from '../rational';

const document = emptyDocument('rc-charge-discharge');
document.title = '축전기 충전·방전';
const source = createComponent('adjustable-voltage-source', 'V1', { x: 240, y: 340 }, 'V_1');
source.properties.voltageV = q.store(10);
const resistor = createComponent('resistor', 'R1', { x: 580, y: 220 }, 'R_1');
resistor.properties.resistanceOhm = q.store(10000);
const capacitor = createComponent('capacitor', 'C1', { x: 800, y: 340 }, 'C_1');
capacitor.rotation = 90;
const toggle = createComponent('changeover-switch', 'S1', { x: 400, y: 220 }, 'S_1');
toggle.rotation = 180;
document.components = [source, resistor, capacitor, toggle];
document.junctions = [{ id: 'G', position: { x: 240, y: 460 } }];
document.referenceNode = { kind: 'junction', id: 'G' };
document.wires = [
  { id: 'W1', start: { kind: 'terminal', id: 'V1.a' }, end: { kind: 'terminal', id: 'S1.a' }, waypoints: [{ x: 240, y: 244 }] },
  { id: 'W2', start: { kind: 'terminal', id: 'S1.common' }, end: { kind: 'terminal', id: 'R1.a' }, waypoints: [] },
  { id: 'W3', start: { kind: 'terminal', id: 'R1.b' }, end: { kind: 'terminal', id: 'C1.a' }, waypoints: [{ x: 800, y: 220 }] },
  { id: 'W4', start: { kind: 'terminal', id: 'C1.b' }, end: { kind: 'junction', id: 'G' }, waypoints: [{ x: 800, y: 460 }] },
  { id: 'W5', start: { kind: 'terminal', id: 'V1.b' }, end: { kind: 'junction', id: 'G' }, waypoints: [] },
  { id: 'W6', start: { kind: 'terminal', id: 'S1.b' }, end: { kind: 'junction', id: 'G' }, waypoints: [{ x: 376, y: 140 }, { x: 120, y: 140 }, { x: 120, y: 460 }] },
];
export const rcChargeExample = { id: 'RC-01', title: document.title, document };
