// Manual benchmark, deliberately outside timing-sensitive CI assertions.
// node --expose-gc tools/benchmark-dc.mjs [report.json] [--soak | --case=substring --once]
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';

async function load(profile = false, soak = false) {
  if (profile) globalThis.__dcObserve = () => {};
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    plugins: profile
      ? [
          {
            name: 'measure-rational-construction',
            enforce: 'pre',
            transform(code, id) {
              if (!id.replaceAll('\\', '/').endsWith('/src/rational/arithmetic.ts')) return;
              return code.replace(
                'if (d === 0n)',
                'globalThis.__dcObserve(n, d);\n  if (d === 0n)',
              );
            },
          },
        ]
      : [],
  });
  try {
    const benchmark = await server.ssrLoadModule('/tools/benchmark-dc.ts');
    const filter = process.argv.find((a) => a.startsWith('--case='))?.slice(7) ?? '';
    return await (soak
      ? benchmark.soak()
      : benchmark.run(profile, filter, process.argv.includes('--once')));
  } finally {
    await server.close();
  }
}
const report = {
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    totalMemoryGiB: os.totalmem() / 2 ** 30,
  },
  timings: process.argv.includes('--soak') ? undefined : await load(),
  // Instrumentation is a separate pass: bigint-to-string overhead is excluded from timings.
  integers:
    process.argv.includes('--soak') || process.argv.includes('--once')
      ? undefined
      : await load(true),
  soak:
    process.argv.includes('--once') || process.argv.some((a) => a.startsWith('--case='))
      ? undefined
      : await load(false, true),
};
delete globalThis.__dcObserve;
const output = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'dc-benchmark.json';
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Saved ${output}`);
