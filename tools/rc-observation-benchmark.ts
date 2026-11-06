import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { emptyDocument, rcPolicy } from '../src/domain';
import { createComponent } from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import { rcEngine, rcInitialState, rcCircuitRevision, observeRcFrame } from '../src/simulation';
import { buildCurrentModel, buildPotentialModel } from '../src/visualization';
import * as q from '../src/rational';

const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    p95Ms: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))].toFixed(3)) };
};
const rows = [];
for (const count of [1, 4, 16, 32]) {
  const doc = emptyDocument(`rc-benchmark-${count}`);
  doc.junctions = ['g', 's', ...Array.from({ length: count }, (_, i) => `n${i}`)]
    .map((id, i) => ({ id, position: { x: 150 * i, y: 250 } }));
  doc.referenceNode = { kind: 'junction', id: 'g' };
  const add = (kind: 'resistor' | 'capacitor' | 'dc-voltage-source', id: string, a: string, b: string, value: number) => {
    const c = createComponent(kind, id, { x: doc.components.length * 120, y: 100 });
    c.properties[kind === 'capacitor' ? 'capacitanceF' : kind === 'resistor' ? 'resistanceOhm' : 'voltageV'] = q.store(value);
    doc.components.push(c);
    [a, b].forEach((node, i) => doc.wires.push({ id: `${id}:w${i}`, start: { kind: 'terminal', id: c.terminals[i].id }, end: { kind: 'junction', id: node }, waypoints: [] }));
  };
  add('dc-voltage-source', 'V', 's', 'g', 10);
  for (let i = 0; i < count; i++) {
    add('resistor', `R${i}`, i ? `n${i - 1}` : 's', `n${i}`, 1);
    add('capacitor', `C${i}`, `n${i}`, 'g', 1);
  }
  const prepareMs: number[] = [], frameMs: number[] = [];
  let status = '';
  for (let trial = 0; trial < 5; trial++) {
    const start = performance.now(), compilation = compileCircuit(doc), circuit = compilation.circuit;
    const prepared = rcEngine.prepare({ circuit, initialState: rcInitialState(circuit), circuitRevision: rcCircuitRevision(circuit), operationIndex: 0, transition: 'initial', policy: rcPolicy });
    prepareMs.push(performance.now() - start);
    if (!prepared.ok) { status = prepared.diagnostics.map(d => d.code).join(','); continue; }
    status = 'solved';
    for (let i = 1; i <= 60; i++) {
      const tick = performance.now();
      const sample = rcEngine.sample(prepared.value, { kind: 'finite', seconds: prepared.value.summary.settlingTimeSeconds * i / 61 });
      if (!sample.ok) throw new Error(JSON.stringify(sample.diagnostics));
      const view = observeRcFrame(sample.value);
      buildCurrentModel(doc, compilation, view);
      buildPotentialModel(doc, circuit, view);
      frameMs.push(performance.now() - tick);
    }
  }
  rows.push({ capacitors: count, status, prepare: summary(prepareMs), ...(frameMs.length ? { sampleAndModels: summary(frameMs) } : {}) });
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, trials: 5, samplesPerTrial: 60, rows }, null, 2));
