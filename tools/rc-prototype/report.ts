import { performance } from 'node:perf_hooks';
import { prepareRc, defaultLimits, type RcCircuit } from './index';
import references from '../../tests/fixtures/rc-prototype-reference.json';

function ladder(n: number, ratio = 1): RcCircuit {
  const nodes = ['g', 's', ...Array.from({ length: n }, (_, i) => `n${i}`)];
  const elements: RcCircuit['elements'] = [
    { id: 'V', kind: 'voltage', a: 's', b: 'g', value: '10' },
  ];
  for (let i = 0; i < n; i++) {
    elements.push({
      id: `R${i}`,
      kind: 'resistor',
      a: i ? `n${i - 1}` : 's',
      b: `n${i}`,
      value: String(i ? ratio : 1),
    });
    elements.push({ id: `C${i}`, kind: 'capacitor', a: `n${i}`, b: 'g', value: '1' });
  }
  return { nodes, elements, reference: 'g' };
}
const circuits = [
  ...references.cases.map((c) => ({ name: c.name, circuit: c.circuit as unknown as RcCircuit })),
  ...[8, 16, 32, 33].map((n) => ({ name: `ladder-${n}`, circuit: ladder(n) })),
  ...[1e12, 1e16, 1e20].map((r) => ({ name: `two-stage-ratio-${r}`, circuit: ladder(2, r) })),
];
const results = circuits.map(({ name, circuit }) => {
  const start = performance.now();
  const result = prepareRc(circuit);
  const prepareMs = performance.now() - start;
  if (!result.ok) return { name, prepareMs, ...result };
  const plan = result.value;
  let sampleFailure: unknown = null;
  const samplesStart = performance.now();
  for (let i = 0; i <= 100; i++) {
    const sample = plan.sample((plan.summary.settlingTime * i) / 100);
    if (!sample.ok) {
      sampleFailure = sample.diagnostic;
      break;
    }
  }
  return {
    name,
    prepareMs,
    sample101Ms: performance.now() - samplesStart,
    summary: plan.summary,
    sampleFailure,
  };
});
console.log(
  JSON.stringify(
    {
      prototype: 'C0',
      node: process.version,
      platform: process.platform,
      limits: defaultLimits,
      reference: references.method,
      results,
    },
    null,
    2,
  ),
);
