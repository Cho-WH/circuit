// Reproducible C0 report; output artifacts stay in the existing ignored workspace tools directory.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, '.tools', 'rc-c0-tmp');
await mkdir(directory, { recursive: true });
const outfile = path.join(directory, 'report.cjs');
await build({
  entryPoints: [fileURLToPath(new URL('report.ts', import.meta.url))],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
});
const child = spawnSync(process.execPath, [outfile], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
