import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  annotationPlacements,
  annotationPresentation,
  componentPresentation,
  formatDisplayQuantity,
} from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import {
  cloneDocument,
  validateDocument,
  type Annotation,
  type CircuitDocument,
} from '../src/domain';
import { createHistory, executeCommand, redo, undo } from '../src/editor';
import { copyPng, exportPng, exportSvg } from '../src/export';
import { solveCircuit } from '../src/simulation';

function fixture(name = 'FIX-02-series.json'): CircuitDocument {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), 'fixtures', name), 'utf8'),
  ) as { document: unknown };
  const validation = validateDocument(raw.document);
  if (!validation.ok) throw new Error(`invalid fixture ${name}`);
  return validation.document;
}

function solve(document: CircuitDocument) {
  const compilation = compileCircuit(document);
  expect(compilation.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  const result = solveCircuit(compilation.circuit);
  expect(result.status).toBe('solved');
  return { circuit: compilation.circuit, result };
}

describe('worksheet component presentation', () => {
  it('applies every problem rule while the answer view reveals actual values', () => {
    const document = fixture();
    const { result } = solve(document);
    const resistor = document.components.find((item) => item.id === 'R1')!;
    resistor.properties = {
      ...resistor.properties,
      labelDisplay: 'blank',
      answerDisplay: '?',
      showVoltage: true,
      voltageDisplay: 'custom',
      voltageText: 'U_R',
      showCurrent: true,
      currentDisplay: 'hidden',
    };

    expect(componentPresentation(resistor, 'problem', result)).toEqual({
      label: '________',
      value: '?',
      voltage: 'U_R',
      current: null,
    });
    expect(componentPresentation(resistor, 'answer', result)).toEqual({
      label: 'R1',
      value: '3.00 Ω',
      voltage: '3.00 V',
      current: '1.00 A',
    });

    const expected = new Map<string, string | null>([
      ['value', '3.00 Ω'],
      ['hidden', null],
      ['?', '?'],
      ['blank', '________'],
      ['custom', 'R_x'],
    ]);
    for (const [rule, text] of expected) {
      resistor.properties.answerDisplay = rule;
      resistor.properties.answerText = 'R_x';
      expect(componentPresentation(resistor, 'problem', result).value).toBe(text);
    }
  });

  it('formats raw values without changing them and honors each public number mode', () => {
    const value = 12_345.6789;
    expect(formatDisplayQuantity(value, 'Ω')).toBe('12.3 kΩ');
    expect(formatDisplayQuantity(value, 'Ω', { kind: 'significant', digits: 5 })).toBe('12.346 kΩ');
    expect(formatDisplayQuantity(value, 'Ω', { kind: 'fixed', digits: 2 })).toBe('12345.68 Ω');
    expect(formatDisplayQuantity(value, 'Ω', { kind: 'integer' })).toBe('12346 Ω');
    expect(formatDisplayQuantity(-0, 'A')).toBe('0 A');
    expect(formatDisplayQuantity(undefined, 'V')).toBe('— V');
    expect(value).toBe(12_345.6789);
  });

  it('keeps connectivity and physics byte-equivalent when only worksheet metadata changes', () => {
    const original = fixture();
    const decorated = cloneDocument(original);
    decorated.components[1].properties = {
      ...decorated.components[1].properties,
      answerDisplay: 'blank',
      answerText: 'R?',
      labelDisplay: 'custom',
      labelText: '저항 A',
      voltageDisplay: '?',
      currentDisplay: 'hidden',
      showVoltage: true,
      showCurrent: true,
    };
    decorated.annotations.push({
      id: 'teacher-note',
      kind: 'question',
      anchor: { kind: 'terminal', id: decorated.components[1].terminals[0].id },
      content: '전압은?',
      visibility: 'problem',
    });

    const before = solve(original);
    const after = solve(decorated);
    expect(after.circuit).toEqual(before.circuit);
    expect(after.result).toEqual(before.result);
    expect(componentPresentation(decorated.components[1], 'problem', after.result)).not.toEqual(
      componentPresentation(decorated.components[1], 'answer', after.result),
    );
    expect(original.annotations).toEqual([]);
  });
});

describe('worksheet annotation presentation', () => {
  const annotation = (
    id: string,
    kind: Annotation['kind'],
    visibility: Annotation['visibility'],
    content = '',
  ): Annotation => ({
    id,
    kind,
    visibility,
    content,
    anchor: { kind: 'terminal', id: 'R1.a' },
  });

  it('honors always/problem/answer/hidden visibility and default blank/question text', () => {
    expect(annotationPresentation(annotation('a', 'label', 'always', 'A'), 'problem')).toBe('A');
    expect(annotationPresentation(annotation('p', 'blank', 'problem'), 'problem')).toBe('________');
    expect(annotationPresentation(annotation('q', 'question', 'answer'), 'answer')).toBe('?');
    expect(annotationPresentation(annotation('p', 'note', 'problem', '설명'), 'answer')).toBeNull();
    expect(annotationPresentation(annotation('h', 'arrow', 'hidden', 'I'), 'problem')).toBeNull();
  });

  it('places multiple visible annotation kinds deterministically without changing anchors', () => {
    const document = fixture();
    document.annotations = [
      annotation('point', 'label', 'always', 'A'),
      annotation('arrow', 'arrow', 'problem', 'I'),
      annotation('unknown', 'question', 'problem'),
      annotation('explanation', 'note', 'problem', '전류 방향'),
      annotation('answer-only', 'blank', 'answer'),
    ];
    const snapshot = cloneDocument(document);

    const placements = annotationPlacements(document, 'problem');
    expect(placements.map((item) => [item.annotation.kind, item.text])).toEqual([
      ['label', 'A'],
      ['arrow', 'I'],
      ['question', '?'],
      ['note', '전류 방향'],
    ]);
    expect(placements.map((item) => item.y)).toEqual([
      placements[0].y,
      placements[0].y - 28,
      placements[0].y - 56,
      placements[0].y - 84,
    ]);
    expect(annotationPlacements(document, 'problem')).toEqual(placements);
    expect(document).toEqual(snapshot);
  });
});

describe('annotation editor command', () => {
  it('updates immutably and participates in undo and redo', () => {
    const document = fixture();
    document.annotations = [{
      id: 'note',
      kind: 'note',
      anchor: { kind: 'terminal', id: 'R1.a' },
      content: 'before',
      visibility: 'problem',
    }];
    const frozen = cloneDocument(document);
    const updated = executeCommand(createHistory(document), {
      type: 'UpdateAnnotation',
      id: 'note',
      changes: { kind: 'arrow', content: 'I', visibility: 'always' },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.history.present.annotations[0]).toMatchObject({
      kind: 'arrow', content: 'I', visibility: 'always',
    });
    expect(document).toEqual(frozen);
    expect(undo(updated.history).present.annotations[0].content).toBe('before');
    expect(redo(undo(updated.history)).present.annotations[0].content).toBe('I');
  });

  it('rejects missing annotations and invalid replacement anchors without mutating history', () => {
    const document = fixture();
    document.annotations = [{
      id: 'note',
      kind: 'note',
      anchor: { kind: 'terminal', id: 'R1.a' },
      content: 'safe',
      visibility: 'always',
    }];
    const history = createHistory(document);
    const missing = executeCommand(history, {
      type: 'UpdateAnnotation', id: 'missing', changes: { content: 'x' },
    });
    expect(missing).toMatchObject({ ok: false, diagnostics: [{ code: 'COMMAND_TARGET_NOT_FOUND' }] });

    const invalid = executeCommand(history, {
      type: 'UpdateAnnotation',
      id: 'note',
      changes: { anchor: { kind: 'terminal', id: 'absent' } },
    });
    expect(invalid).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_REFERENCE' }] });
    expect(history.present).toEqual(document);
  });
});

function svgDimensions(svg: string) {
  const root = svg.match(/^<svg\b[^>]*\bwidth="([^"]+)"[^>]*\bheight="([^"]+)"[^>]*\bviewBox="([^"]+)"/);
  if (!root) throw new Error('missing SVG dimensions');
  return {
    width: Number(root[1]),
    height: Number(root[2]),
    viewBox: root[3].split(' ').map(Number),
  };
}

describe('independent worksheet SVG export', () => {
  it('is deterministic, valid-looking standalone SVG and never mutates its inputs', () => {
    const document = fixture();
    const { result } = solve(document);
    const documentBefore = cloneDocument(document);
    const resultBefore = structuredClone(result);

    const first = exportSvg(document, { mode: 'answer' }, result);
    const second = exportSvg(document, { mode: 'answer' }, result);
    expect(second).toBe(first);
    expect(first.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(first.endsWith('</svg>')).toBe(true);
    expect(first).toContain('<polyline');
    expect(first).toContain('R1');
    expect(first).toContain('3.00 Ω');
    expect(first).not.toMatch(/selection|selected|toolbar|zoom|pan/i);
    expect(document).toEqual(documentBefore);
    expect(result).toEqual(resultBefore);
  });

  it('renders problem and answer variants from one document without storing calculated answers', () => {
    const document = fixture();
    const { result } = solve(document);
    const resistor = document.components.find((item) => item.id === 'R1')!;
    resistor.properties = {
      ...resistor.properties,
      answerDisplay: '?',
      labelDisplay: 'custom',
      labelText: '가',
      showVoltage: true,
      voltageDisplay: 'blank',
      showCurrent: true,
      currentDisplay: 'hidden',
    };
    const snapshot = cloneDocument(document);

    const problem = exportSvg(document, { mode: 'problem' }, result);
    const answer = exportSvg(document, { mode: 'answer' }, result);
    expect(problem).toContain('>?</text>');
    expect(problem).toContain('>가</text>');
    expect(problem).toContain('>U = ________</text>');
    expect(problem).not.toContain('>I = 1.00 A</text>');
    expect(answer).toContain('>R1</text>');
    expect(answer).toContain('>3.00 Ω</text>');
    expect(answer).toContain('>U = 3.00 V</text>');
    expect(answer).toContain('>I = 1.00 A</text>');
    expect(document).toEqual(snapshot);
    expect(Object.keys(resistor.properties)).not.toContain('calculatedVoltage');
  });

  it('escapes every user-controlled text field and removes forbidden XML controls', () => {
    const document = fixture();
    document.title = '</title><script>alert("title")</script>&';
    document.components[1].label = '<img src=x onerror="label">&\'';
    document.components[1].properties.labelDisplay = 'custom';
    document.components[1].properties.labelText = '<b>custom</b>\u0000';
    document.annotations = [{
      id: 'unsafe',
      kind: 'note',
      anchor: { kind: 'terminal', id: 'R1.a' },
      content: '<script>alert("note")</script>&\'',
      visibility: 'always',
    }];

    const svg = exportSvg(document, { mode: 'problem' });
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('\u0000');
    expect(svg).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;&amp;');
    expect(svg).toContain('&lt;b&gt;custom&lt;/b&gt;�');
    expect(svg).toContain('&lt;script&gt;alert(&quot;note&quot;)&lt;/script&gt;&amp;&apos;');
  });

  it('honors annotation visibility and draws labels, arrows, questions, blanks, and notes', () => {
    const document = fixture();
    document.annotations = [
      { id: 'point', kind: 'label', anchor: { kind: 'terminal', id: 'R1.a' }, content: 'A', visibility: 'always' },
      { id: 'arrow', kind: 'arrow', anchor: { kind: 'terminal', id: 'R1.a' }, content: 'I', visibility: 'problem' },
      { id: 'question', kind: 'question', anchor: { kind: 'terminal', id: 'R1.a' }, content: '', visibility: 'problem' },
      { id: 'blank', kind: 'blank', anchor: { kind: 'terminal', id: 'R1.a' }, content: '', visibility: 'answer' },
      { id: 'note', kind: 'note', anchor: { kind: 'terminal', id: 'R1.a' }, content: '해설', visibility: 'answer' },
      { id: 'hidden', kind: 'note', anchor: { kind: 'terminal', id: 'R1.a' }, content: 'SECRET', visibility: 'hidden' },
    ];

    const problem = exportSvg(document, { mode: 'problem' });
    expect(problem).toContain('>A</text>');
    expect(problem).toContain('>I</text>');
    expect(problem).toContain('>?</text>');
    expect(problem).toMatch(/<path d="M[^>]+H[^>]+ M[^>]+L/);
    expect(problem).not.toContain('>해설</text>');
    expect(problem).not.toContain('SECRET');

    const answer = exportSvg(document, { mode: 'answer' });
    expect(answer).toContain('>A</text>');
    expect(answer).toContain('>________</text>');
    expect(answer).toContain('>해설</text>');
    expect(answer).not.toContain('>I</text>');
    expect(answer).not.toContain('SECRET');
  });

  it('applies monochrome, background, margin, and number-format options independently', () => {
    const document = fixture();
    const { result } = solve(document);
    document.components[1].properties.showVoltage = true;
    document.components[1].properties.showCurrent = true;

    const transparent = exportSvg(document, {
      monochrome: true,
      background: 'transparent',
      margin: 10,
      numberFormat: { kind: 'fixed', digits: 1 },
    }, result);
    expect(transparent).not.toContain('fill="#ffffff"/>');
    expect(new Set(transparent.match(/#[0-9a-fA-F]{6}/g))).toEqual(new Set(['#111111']));
    expect(transparent).toContain('>3.0 Ω</text>');
    expect(transparent).toContain('>U = 3.0 V</text>');

    const white = exportSvg(document, { background: 'white', margin: 50 }, result);
    expect(white).toMatch(/<rect [^>]*fill="#ffffff"\/>/);
    const small = svgDimensions(transparent);
    const large = svgDimensions(white);
    expect(large.width - small.width).toBeCloseTo(80, 8);
    expect(large.height - small.height).toBeCloseTo(80, 8);
    expect(large.viewBox[2]).toBe(large.width);
    expect(large.viewBox[3]).toBe(large.height);
  });

  it('keeps empty, rotated, and long-text drawings inside finite supported bounds', () => {
    const empty = fixture();
    empty.components = [];
    empty.wires = [];
    empty.junctions = [];
    empty.annotations = [];
    empty.referenceNode = null;
    expect(svgDimensions(exportSvg(empty, { margin: 0 }))).toEqual({
      width: 800,
      height: 500,
      viewBox: [100, 100, 800, 500],
    });

    const document = fixture();
    document.components[1].rotation = 90;
    document.components[1].label = '매우 긴 부품 이름 '.repeat(20);
    document.annotations = [{
      id: 'long', kind: 'note', anchor: { kind: 'terminal', id: 'R1.a' },
      content: '긴 설명 '.repeat(100), visibility: 'always',
    }];
    const dimensions = svgDimensions(exportSvg(document, { margin: 24 }));
    expect(dimensions.width).toBeGreaterThan(1000);
    expect(dimensions.height).toBeGreaterThan(200);
    expect(dimensions.viewBox.every(Number.isFinite)).toBe(true);
  });

  it('rejects invalid documents and unsafe export dimensions rather than emitting corrupt markup', () => {
    const document = fixture();
    const invalid = cloneDocument(document);
    invalid.wires[0].start.id = 'missing';
    expect(() => exportSvg(invalid)).toThrow();
    expect(() => exportSvg(document, { margin: -1 })).toThrow(/margin/);
    expect(() => exportSvg(document, { pngScale: 0 })).toThrow(/pngScale/);
    expect(() => exportSvg(document, { numberFormat: { kind: 'fixed', digits: 11 } })).toThrow(/digits/);
  });
});

describe('PNG rasterization and clipboard fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  function installRasterMocks() {
    const canvases: Array<{ width: number; height: number }> = [];
    const drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        expect(tag).toBe('canvas');
        const canvas = {
          width: 0,
          height: 0,
          getContext: (kind: string) => kind === '2d' ? { drawImage } : null,
          toBlob: (callback: (blob: Blob | null) => void, type: string) => {
            callback(new Blob(['png'], { type }));
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    });
    return { canvases, drawImage };
  }

  it('rasterizes at the requested integer pixel dimensions and returns a PNG blob', async () => {
    const document = fixture();
    const { canvases, drawImage } = installRasterMocks();
    const svg = svgDimensions(exportSvg(document, { margin: 24 }));
    const blob = await exportPng(document, { margin: 24, pngScale: 3 });

    expect(blob.type).toBe('image/png');
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({
      width: Math.ceil(svg.width * 3),
      height: Math.ceil(svg.height * 3),
    });
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('returns the generated PNG unchanged when clipboard image writing is unavailable', async () => {
    const document = fixture();
    installRasterMocks();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('ClipboardItem', class ClipboardItem {});

    const copied = await copyPng(document, { pngScale: 1 });
    expect(copied.copied).toBe(false);
    expect(copied.blob.type).toBe('image/png');
    expect(await copied.blob.text()).toBe('png');
  });

  it('returns the same usable PNG when browser clipboard permission is rejected', async () => {
    const document = fixture();
    installRasterMocks();
    const write = vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', class ClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    });

    const copied = await copyPng(document, { pngScale: 1 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(copied.copied).toBe(false);
    expect(copied.blob.type).toBe('image/png');
    expect(await copied.blob.text()).toBe('png');
  });
});
