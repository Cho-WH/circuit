import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

type SourceFixture = Record<string, string>;

type CheckResult = {
  status: number | null;
  output: string;
};

const root = resolve(process.cwd());
const boundaryChecker = join(root, 'tools', 'check-boundaries.mjs');

function runBoundaryFixture(files: SourceFixture): CheckResult {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'circuit-boundary-'));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const destination = join(temporaryRoot, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, source, 'utf8');
    }

    const result = spawnSync(process.execPath, [boundaryChecker, temporaryRoot], {
      cwd: temporaryRoot,
      encoding: 'utf8',
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

describe('module boundary checker', () => {
  it('rejects a runtime cycle inside one module through a barrel export', () => {
    const result = runBoundaryFixture({
      'src/simulation/index.ts':
        'export { measure } from "./measurements"; export const solve = () => 1;',
      'src/simulation/measurements.ts':
        'import { solve } from "./index"; export const measure = () => solve();',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('runtime file dependency cycle:');
    expect(result.output).toContain('src/simulation/measurements.ts');
  });

  it('accepts erased type references and ignores imports inside comments', () => {
    const result = runBoundaryFixture({
      'src/editor/index.ts': 'export { edit } from "./edit"; export interface Command {}',
      'src/editor/edit.ts':
        'import { type Command } from "./index"; export type { Command } from "./index"; export const edit = (c: Command) => c; // import "../app";',
      'src/app/index.ts': 'import "../editor";',
    });
    expect(result.status, result.output).toBe(0);
  });

  it('resolves dynamic imports, require calls and explicit source extensions', () => {
    const result = runBoundaryFixture({
      'src/app/index.ts': 'export const load = () => import("./view.ts");',
      'src/app/view.ts': 'require("./index.ts");',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('runtime file dependency cycle:');
  });

  it('accepts core dependencies through a module public index', () => {
    const result = runBoundaryFixture({
      'src/domain/index.ts': 'export type Id = string;\n',
      'src/connectivity/index.ts':
        'import type { Id } from "../domain";\nexport type NetId = Id;\n',
    });

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('Module boundaries are valid');
  });

  it('rejects a core module importing a UI module by directory', () => {
    const result = runBoundaryFixture({
      'src/domain/index.ts': 'import "../app";\nexport type Id = string;\n',
      'src/app/index.ts': 'export const app = true;\n',
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('core module imports UI/browser module "app"');
    expect(result.output).toContain('domain imports feature module "app"');
  });

  it("rejects imports of another module's private file", () => {
    const result = runBoundaryFixture({
      'src/domain/index.ts': 'export { hidden } from "./private";\n',
      'src/domain/private.ts': 'export const hidden = true;\n',
      'src/connectivity/index.ts':
        'import { hidden } from "../domain/private";\nexport { hidden };\n',
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('imports internal file "../domain/private"');
    expect(result.output).toContain("import domain's public index instead");
  });

  it('rejects a cycle formed through public directory imports', () => {
    const result = runBoundaryFixture({
      'src/connectivity/index.ts': 'import "../simulation";\nexport const connectivity = true;\n',
      'src/simulation/index.ts': 'import "../connectivity";\nexport const simulation = true;\n',
    });

    expect(result.status).toBe(1);
    expect(result.output).toMatch(
      /module dependency cycle: (connectivity -> simulation -> connectivity|simulation -> connectivity -> simulation)/,
    );
  });
});
