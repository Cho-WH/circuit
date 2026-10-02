import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const excluded = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.venv',
  '.npm-cli',
  '.pnpm-store',
  '.tools',
  '.firebase',
  '.firebase-local',
  '.vite',
]);

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return excluded.has(entry.name) ? [] : markdownFiles(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

/** Local inline links only; remote availability and heading anchors are separate concerns. */
function linkErrors(file: string, text: string): string[] {
  const errors: string[] = [];
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
    const path = target.split('#', 1)[0];
    const resolved = resolve(dirname(file), path);
    const fromRoot = relative(root, resolved);
    if (isAbsolute(fromRoot) || fromRoot.split(/[\\/]/)[0] === '..')
      errors.push(`link escapes root: ${target}`);
    else if (!existsSync(resolved)) errors.push(`missing link target: ${target}`);
  }
  return errors;
}

describe('repository Markdown links', () => {
  it('resolves local link targets within the repository', () => {
    const errors = markdownFiles(root).flatMap((file) =>
      linkErrors(file, readFileSync(file, 'utf8')).map(
        (error) => `${relative(root, file)}: ${error}`,
      ),
    );
    expect(errors).toEqual([]);
  });

  it('detects deleted and outside targets while accepting relative paths and fragments', () => {
    const file = join(root, 'docs', 'index.md');
    expect(
      linkErrors(
        file,
        '[guide](../README.md#실행) [section](#local) [web](https://example.invalid)',
      ),
    ).toEqual([]);
    expect(linkErrors(file, '[old](../schemas/circuit-document-v1.schema.json)')).toEqual([
      'missing link target: ../schemas/circuit-document-v1.schema.json',
    ]);
    expect(linkErrors(file, '[outside](../../outside.md)')).toEqual([
      'link escapes root: ../../outside.md',
    ]);
  });
});
