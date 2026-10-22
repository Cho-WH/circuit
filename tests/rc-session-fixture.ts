import { emptyDocument } from '../src/domain';
import { createComponent } from '../src/component-library';
import * as q from '../src/rational';

/** τ=1s at defaults; switch shorts C only when explicitly closed. */
export function rcSessionDocument(initial = 0, resistance = 10000, capacitance = 0.0001) {
  const doc = emptyDocument('rc-session');
  const source = createComponent('adjustable-voltage-source', 'V', { x: 0, y: 100 });
  source.properties.voltageV = q.store(10);
  const resistor = createComponent('resistor', 'R', { x: 150, y: 100 });
  resistor.properties.resistanceOhm = q.store(resistance);
  const capacitor = createComponent('capacitor', 'C', { x: 300, y: 100 });
  capacitor.properties.capacitanceF = q.store(capacitance);
  capacitor.properties.initialVoltageV = q.store(initial);
  const toggle = createComponent('switch', 'S', { x: 450, y: 100 });
  doc.components = [source, resistor, capacitor, toggle];
  doc.junctions = ['g', 's', 'a'].map((id, i) => ({ id, position: { x: i * 150, y: 250 } }));
  doc.referenceNode = { kind: 'junction', id: 'g' };
  for (const [index, nodes] of [
    ['s', 'g'],
    ['s', 'a'],
    ['a', 'g'],
    ['a', 'g'],
  ].entries())
    for (const [terminal, node] of nodes.entries())
      doc.wires.push({
        id: `w${index}${terminal}`,
        start: { kind: 'terminal', id: doc.components[index].terminals[terminal].id },
        end: { kind: 'junction', id: node },
        waypoints: [],
      });
  return doc;
}
