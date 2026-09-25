import { formatQuantity } from '../src/quantity';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  componentDefinitions,
  symbolMarkup,
  annotationPlacements,
  annotationPresentation,
  componentPresentation,
} from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import {
  cloneDocument,
  validateDocument,
  type Annotation,
  type CircuitDocument,
} from '../src/domain';
import { createHistory, executeCommand, redo, undo } from '../src/editor';
import { copyPng, exportPng, exportSvg as standaloneSvg } from '../src/export';
import { solveCircuit } from '../src/simulation';
import { outputMoveCommand } from '../src/app/OutputCanvas';
import { parseDocument, serializeDocument } from '../src/persistence';

// Geometry assertions omit binary font payload; embedding is tested separately.
function exportSvg(...args:Parameters<typeof standaloneSvg>){return standaloneSvg(...args).replace(/<style>[\s\S]*?<\/style>/g,'');}

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
  it('uses actual component values with visibility and rectangular blank controls', () => {
    const document = fixture();
    const { result } = solve(document);
    const resistor = document.components.find((item) => item.id === 'R1')!;
    resistor.properties = {
      ...resistor.properties,
      labelBlank: true,
      answerBlank: false,
      showVoltage: true,
      showCurrent: true,
      currentVisible: false,
    };

    expect(componentPresentation(resistor, result)).toEqual({
      label: '□',
      value: '3 Ω',
      voltage: formatQuantity(result.componentVoltages[resistor.id], 'V'),
      current: null,
    });

    resistor.properties.answerBlank = true;
    expect(componentPresentation(resistor, result).value).toBe('□');
    resistor.properties.answerVisible = false;
    expect(componentPresentation(resistor, result).value).toBeNull();
    resistor.properties.answerVisible = true;
    resistor.properties.answerBlank = false;
    resistor.properties.resistanceOhm = 12;
    resistor.label = 'R_new';
    expect(componentPresentation(resistor, result)).toMatchObject({ label: '□', value: '12 Ω' });
    resistor.properties.labelBlank = false;
    expect(componentPresentation(resistor, result).label).toBe('R_new');
  });

  it('rounds output numbers to at most two decimals without trailing zeroes or negative zero', () => {
    expect(formatQuantity(12345.6789,'Ω')).toBe('12.35 kΩ');
    expect(formatQuantity(3,'V')).toBe('3 V');
    expect(formatQuantity(1.5,'V')).toBe('1.5 V');
    expect(formatQuantity(1.236,'A')).toBe('1.24 A');
    expect(formatQuantity(-0.001,'A')).toBe('-1 mA');
    expect(formatQuantity(undefined,'V')).toBe('— V');
  });

  it('keeps connectivity and physics byte-equivalent when only worksheet metadata changes', () => {
    const original = fixture();
    const decorated = cloneDocument(original);
    decorated.components[1].properties = {
      ...decorated.components[1].properties,
      answerBlank: true,
      labelVisible: false,
      voltageBlank: true,
      currentVisible: false,
      showVoltage: true,
      showCurrent: true,
    };
    decorated.annotations.push({
      id: 'teacher-note',
      kind: 'question',
      anchor: { kind: 'terminal', id: decorated.components[1].terminals[0].id },
      content: '전압은?',
      visibility: 'always',
    });

    const before = solve(original);
    const after = solve(decorated);
    expect(after.circuit).toEqual(before.circuit);
    expect(after.result).toEqual(before.result);
    expect(componentPresentation(decorated.components[1], after.result)).not.toEqual(componentPresentation(original.components[1], before.result));
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

  it('honors visibility and default blank/question text', () => {
    expect(annotationPresentation(annotation('a', 'label', 'always', 'A'))).toBe('A');
    expect(annotationPresentation(annotation('p', 'blank', 'always'))).toBe('□');
    expect(annotationPresentation(annotation('q', 'question', 'always'))).toBe('?');
    expect(annotationPresentation(annotation('p', 'note', 'hidden', '설명'))).toBeNull();
    expect(annotationPresentation(annotation('h', 'arrow', 'hidden', 'I'))).toBeNull();
  });

  it('places multiple visible annotation kinds deterministically without changing anchors', () => {
    const document = fixture();
    document.annotations = [
      annotation('point', 'label', 'always', 'A'),
      annotation('arrow', 'arrow', 'always', 'I'),
      annotation('unknown', 'question', 'always'),
      annotation('explanation', 'note', 'always', '전류 방향'),
      annotation('hidden-blank', 'blank', 'hidden'),
    ];
    const snapshot = cloneDocument(document);

    const placements = annotationPlacements(document);
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
    expect(annotationPlacements(document)).toEqual(placements);
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
      visibility: 'always',
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

    const first = exportSvg(document, {}, result);
    const second = exportSvg(document, {}, result);
    expect(second).toBe(first);
    expect(first.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(first.endsWith('</svg>')).toBe(true);
    expect(first).toContain('<path d=');
    expect(first).toContain('R1');
    expect(first).toContain('3 Ω');
    expect(first.replace(/<style>[\s\S]*?<\/style>/g,'')).not.toMatch(/selection|selected|toolbar|zoom|pan/i);
    expect(document).toEqual(documentBefore);
    expect(result).toEqual(resultBefore);
  });

  it('renders output notation without storing calculated answers', () => {
    const document = fixture();
    const { result } = solve(document);
    const resistor = document.components.find((item) => item.id === 'R1')!;
    resistor.properties = {
      ...resistor.properties,
      answerBlank: false,
      showVoltage: true,
      voltageBlank: true,
      showCurrent: true,
      currentVisible: false,
    };
    const snapshot = cloneDocument(document);

    const problem = exportSvg(document, {}, result);
    expect(problem).toContain('>3 Ω</text>');
    expect(problem).toContain('>𝑅1</text>');
    expect(problem).toContain('width="84" height="36"');
    expect(problem).not.toContain('>I = 1.00 A</text>');
    expect(document).toEqual(snapshot);
    expect(Object.keys(resistor.properties)).not.toContain('calculatedVoltage');
  });

  it('escapes every user-controlled text field and removes forbidden XML controls', () => {
    const document = fixture();
    document.title = '</title><script>alert("title")</script>&';
    document.components[1].label = '<img src=x onerror="label">&\'\u0000';
    document.annotations = [{
      id: 'unsafe',
      kind: 'note',
      anchor: { kind: 'terminal', id: 'R1.a' },
      content: '<script>alert("note")</script>&\'',
      visibility: 'always',
    }];

    const svg = exportSvg(document, {});
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('\u0000');
    expect(svg).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;&amp;');
    expect(svg).toContain('&lt;𝑖𝑚𝑔'); expect(svg).toContain('�');
    expect(svg).toContain('&lt;script&gt;alert(&quot;note&quot;)&lt;/script&gt;&amp;&apos;');
  });

  it('honors annotation visibility and draws labels, arrows, questions, blanks, and notes', () => {
    const document = fixture();
    document.annotations = [
      { id: 'point', kind: 'label', anchor: { kind: 'terminal', id: 'R1.a' }, content: 'A', visibility: 'always' },
      { id: 'arrow', kind: 'arrow', anchor: { kind: 'terminal', id: 'R1.a' }, content: 'I', visibility: 'always' },
      { id: 'question', kind: 'question', anchor: { kind: 'terminal', id: 'R1.a' }, content: '', visibility: 'always' },
      { id: 'blank', kind: 'blank', anchor: { kind: 'terminal', id: 'R1.a' }, content: '', visibility: 'hidden' },
      { id: 'note', kind: 'note', anchor: { kind: 'terminal', id: 'R1.a' }, content: '해설', visibility: 'hidden' },
      { id: 'hidden', kind: 'note', anchor: { kind: 'terminal', id: 'R1.a' }, content: 'SECRET', visibility: 'hidden' },
    ];

    const problem = exportSvg(document, {});
    expect(problem).toContain('>A</text>');
    expect(problem).toContain('>𝐼</text>');
    expect(problem).toContain('>?</text>');
    expect(problem).toMatch(/<path d="M[^>]+L[^>]+Z" fill="#111111"/);
    expect(problem).not.toContain('>해설</text>');
    expect(problem).not.toContain('SECRET');

  });

  it('applies monochrome, background, margin, options independently', () => {
    const document = fixture();
    const { result } = solve(document);
    document.components[1].properties.showVoltage = true;
    document.components[1].properties.showCurrent = true;

    const transparent = exportSvg(document, {
      monochrome: true,
      background: 'transparent',
      margin: 10,
    }, result);
    expect(transparent).not.toContain('fill="#ffffff"/>');
    expect(new Set(transparent.match(/#[0-9a-fA-F]{6}/g))).toEqual(new Set(['#111111']));
    expect(transparent).toContain('>3 Ω</text>');
    expect(transparent).toContain('>𝑈 = 3 V</text>');

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

  it.each([false,true])('rasterizes at 1x or exactly 2x when highResolution=%s', async highResolution => {
    const document = fixture();
    const { canvases, drawImage } = installRasterMocks();
    const svg = svgDimensions(exportSvg(document, { margin: 24 }));
    const blob = await exportPng(document, { margin: 24, highResolution });

    expect(blob.type).toBe('image/png');
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({
      width: Math.ceil(svg.width) * (highResolution?2:1),
      height: Math.ceil(svg.height) * (highResolution?2:1),
    });
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('returns the generated PNG unchanged when clipboard image writing is unavailable', async () => {
    const document = fixture();
    installRasterMocks();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('ClipboardItem', class ClipboardItem {});

    const copied = await copyPng(document, {});
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

    const copied = await copyPng(document, {});
    expect(write).toHaveBeenCalledTimes(1);
    expect(copied.copied).toBe(false);
    expect(copied.blob.type).toBe('image/png');
    expect(await copied.blob.text()).toBe('png');
  });
});

describe('free output layout', () => {
  it('moves independent text and adjusts arrow length and rotation, round trips and undoes without changing physics', () => {
    const original=fixture();
    const before=solve(original);
    let history=createHistory(original);
    const apply=(command: Parameters<typeof executeCommand>[1])=>{const next=executeCommand(history,command);expect(next.ok).toBe(true);if(next.ok)history=next.history;};
    apply({type:'AddAnnotation',annotation:{id:'free-arrow',kind:'arrow',anchor:null,position:{x:150,y:100},end:{x:230,y:100},content:'I₁',visibility:'always'}});
    apply({type:'UpdateAnnotation',id:'free-arrow',changes:{arrow:{shape:'straight',length:100,legLength:48,rotation:90,reversed:false}}});
    expect(history.present.annotations[0].arrow).toMatchObject({length:100,rotation:90});
    expect(undo(history).present.annotations[0].end).toEqual({x:230,y:100});
    expect(redo(undo(history)).present).toEqual(history.present);
    apply(outputMoveCommand(history.present,{id:'R1',part:'label'},{x:80,y:-120})!);
    apply(outputMoveCommand(history.present,{id:'R1',part:'value'},{x:-50,y:90})!);
    apply({type:'SetLabel',id:'R1',label:'Rₓ'});
    apply({type:'SetProperties',id:'R1',properties:{answerBlank:true}});
    apply({type:'SetOutputScale',scale:1.5});
    const doc=history.present;
    expect(solve(doc)).toEqual(before);
    expect(parseDocument(serializeDocument(doc))).toEqual({ok:true,document:doc});
    const svg=exportSvg(doc);
    expect(svg).toContain('font-size="33.75"');
    expect(svg).toContain('width="126" height="54"');
    expect(svg).toContain('M150 100L150 200');
    expect(svg).toContain('>𝑅ₓ</text>');
    expect(svg).not.toContain('<circle');
    apply({type:'SetProperties',id:'R1',properties:{answerVisible:false}});
    expect(componentPresentation(history.present.components.find(c=>c.id==='R1')!).value).toBeNull();
    apply({type:'SetOutputScale',scale:0.5});
    expect(exportSvg(history.present,{circuitOnly:true})).not.toContain('I₁');
  });

  it('migrates old annotations without mutating the v1 source and preserves its problem appearance', () => {
    const raw=JSON.parse(readFileSync(resolve(process.cwd(),'fixtures','FIX-02-series.json'),'utf8')).document;
    raw.annotations=[{id:'old',kind:'note',anchor:{kind:'terminal',id:'R1.a'},content:'문제',visibility:'problem'},{id:'teacher',kind:'note',anchor:{kind:'terminal',id:'R1.a'},content:'정답',visibility:'answer'}];
    const snapshot=JSON.stringify(raw), parsed=parseDocument(snapshot);
    expect(parsed.ok).toBe(true);if(!parsed.ok)return;
    expect(parsed.document.version).toBe(4);
    expect(parsed.document.annotations.map(a=>a.visibility)).toEqual(['always','hidden']);
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(parseDocument(serializeDocument(parsed.document))).toEqual(parsed);
    expect(exportSvg(parsed.document)).toContain('>문제</text>');
    expect(exportSvg(parsed.document)).not.toContain('>정답</text>');
  });

  it('rejects a free decoration without a position and invalid scale without adding history', () => {
    const history=createHistory(fixture());
    expect(executeCommand(history,{type:'AddAnnotation',annotation:{id:'bad',kind:'point',anchor:null,content:'A',visibility:'always'}}).ok).toBe(false);
    expect(executeCommand(history,{type:'SetOutputScale',scale:Infinity}).ok).toBe(false);
    expect(history.past).toEqual([]);
  });
});


describe('output ground and embedded math font',()=>{
  it('hides ground by default, shows only its symbol on request, and preserves the 3D reference',()=>{
    const doc=fixture();
    expect(doc.referenceNode).not.toBeNull();
    expect(exportSvg(doc)).not.toContain('data-output-ground');
    const shown=exportSvg(doc,{showGround:true});
    expect(shown).toContain('data-output-ground="true"');
    expect(shown).not.toContain('>0 V</text>');
    expect(exportSvg(doc,{showGround:false})).not.toContain('data-output-ground');
    expect(exportSvg(doc,{circuitOnly:true})).toContain('>0 V</text>');
  });
  it('embeds a standalone WOFF2 font for SVG and PNG notation',()=>{
    const svg=standaloneSvg(fixture());
    expect(svg).toContain("font-family:'Libertinus Math'");
    expect(svg).toMatch(/data:font\/woff2;base64,d09GMg/);
    expect(svg).toContain('font-synthesis:none');
    expect(svg).not.toContain('fonts.googleapis.com');
  });
});


describe('variable resistor presentation and compatibility', () => {
  it('uses an adjustment arrow while preserving resistance, terminals and saved type', () => {
    const document=fixture();
    const resistor=document.components.find(item=>item.id==='R1')!;
    const before=solve(document).result;
    const terminals=structuredClone(resistor.terminals);
    expect(symbolMarkup(resistor)).not.toContain('adjustment-arrow');
    resistor.type='resistive-load';
    expect(componentDefinitions[resistor.type].name).toBe('가변저항');
    expect(symbolMarkup(resistor)).toContain('adjustment-arrow');
    expect(exportSvg(document)).toContain('adjustment-arrow');
    expect(resistor.terminals).toEqual(terminals);
    expect(solve(document).result).toEqual(before);
    expect(parseDocument(serializeDocument(document))).toEqual({ok:true,document});
  });
});
