import { defaultQuantityFormat, type QuantityFormatOptions } from '../quantity';
import {
  annotationPlacements,
  arrowGeometry,
  circuitTextScale,
  componentNotationLayout,
  svgNotation,
  notationWidth,
  notationMetrics,
  presentationText,
  componentPresentation,
  endpointPosition,
  escapeXml,
  wirePath,
  wireCrossings,
  symbolMarkup,
  terminalPosition,
  wirePoints,
} from '../component-library';
import { mathFontFace, mathFontFamily } from '../typography';
import { notationTokens } from '../notation';
import {
  DocumentError,
  validateDocument,
  type CircuitDocument,
  type ComponentInstance,
  type SimulationResult,
} from '../domain';


export type ExportBackground = 'transparent' | 'white';

export interface ExportOptions {
  quantityFormat?: QuantityFormatOptions;
  circuitOnly?: boolean;
  monochrome?: boolean;
  background?: ExportBackground;
  margin?: number;
  highResolution?: boolean;
  showGround?: boolean;
}

interface NormalizedExportOptions {
  quantityFormat: QuantityFormatOptions;
  circuitOnly: boolean;
  monochrome: boolean;
  background: ExportBackground;
  margin: number;
  pngScale: number;
  showGround: boolean;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextPlacement {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle';
  blank?: boolean;
  tone: 'label' | 'value' | 'voltage' | 'current';
}

const MAX_LOGICAL_DIMENSION = 1_000_000;
const MAX_PIXEL_DIMENSION = 16_384;
const MAX_PIXEL_COUNT = 67_108_864;
const MIN_CONTENT_SIZE = 200;

function normalizeOptions(options: ExportOptions = {}): NormalizedExportOptions {
  const circuitOnly = options.circuitOnly ?? false;
  const background = options.background ?? 'white';
  const monochrome = options.monochrome ?? true;
  const margin = options.margin ?? 16;
  const pngScale = options.highResolution ? 2 : 1;

  if (background !== 'transparent' && background !== 'white') throw new TypeError('background must be transparent or white');
  if (typeof monochrome !== 'boolean') throw new TypeError('monochrome must be a boolean');
  if (!Number.isFinite(margin) || margin < 0) throw new RangeError('margin must be a finite non-negative number');
  return { quantityFormat:options.quantityFormat??defaultQuantityFormat, circuitOnly, monochrome, background, margin, pngScale, showGround: circuitOnly || (options.showGround ?? false) };
}

function xmlText(value: string): string {
  let valid = '';
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point === 0x9 || point === 0xa || point === 0xd || (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff)) {
      valid += character;
    } else {
      valid += '\ufffd';
    }
  }
  return escapeXml(valid);
}

function numberAttribute(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('SVG coordinates must be finite');
  if (Object.is(value, -0)) return '0';
  return String(Number(value.toFixed(4)));
}

function estimatedTextWidth(text: string): number {
  if (notationTokens(text).some(t => t.kind === 'fraction')) return notationWidth(text,16) + 5;
  let width = 0;
  for (const character of text) {
    if (/\s/u.test(character)) width += 4.5;
    else width += (character.codePointAt(0) ?? 0) > 0xff ? 15.5 : 8.5;
  }
  return Math.max(8, width + 5);
}

function componentTextPlacements(
  component: ComponentInstance,
  circuitOnly: boolean,
  result: SimulationResult | undefined,
  scale: number,
  quantityFormat: QuantityFormatOptions,
): TextPlacement[] {
  const presentation = componentPresentation(circuitOnly ? {...component, properties: Object.fromEntries(Object.entries(component.properties).filter(([key]) => !/^(?:(?:label|answer|voltage|current)(?:Visible|Blank|OffsetX|OffsetY)|showVoltage|showCurrent)$/.test(key)))} : component, result, quantityFormat);
  const layout=componentNotationLayout(component,presentation.label,presentation.value,15*scale);
  const placements: TextPlacement[] = [];
  const add = (text: string | null, tone: TextPlacement['tone']) => {
    const prefix = tone === 'value' ? 'answer' : tone;
    const dx = circuitOnly ? 0 : Number(component.properties[prefix+'OffsetX'] ?? 0);
    const dy = circuitOnly ? 0 : Number(component.properties[prefix+'OffsetY'] ?? 0);
    if (text !== null) placements.push({ text, x: layout[tone].x + dx, y: layout[tone].y + dy, anchor:layout[tone].anchor, tone, blank: text.includes('□') });
  };

  add(presentation.label,'label');
  add(presentation.value,'value');
  add(presentation.voltage === null ? null : `U = ${presentation.voltage}`,'voltage');
  add(presentation.current === null ? null : `I = ${presentation.current}`,'current');
  return placements;
}

function annotationTextPosition(placement: ReturnType<typeof annotationPlacements>[number], scale: number, side=1) {
  const {annotation:a,x,y,text}=placement;
  if(a.kind==='arrow') {
    const end=arrowGeometry(a,{x,y}).points[1],length=Math.hypot(end.x-x,end.y-y)||1;
    const metrics=notationMetrics(text,16*scale),nx=side*(end.y-y)/length,ny=-side*(end.x-x)/length;
    const gap=10*scale;
    // Position the text box, then convert its center to the SVG text baseline.
    return {x:(x+end.x)/2+nx*(metrics.width/2+gap),y:(y+end.y)/2+ny*((metrics.ascent+metrics.descent)/2+gap)+(metrics.ascent-metrics.descent)/2,anchor:'middle' as const};
  }
  return {x:a.kind==='point'?x+10:x,y:a.kind==='point'?y-10:y,anchor:'start' as const};
}

function annotationTextPlacements(placement:ReturnType<typeof annotationPlacements>[number],scale:number) {
  const a=placement.annotation;
  if(a.kind!=='arrow')return [{...annotationTextPosition(placement,scale),text:placement.text,part:'annotation',symbol:a.kind==='point'}];
  const properties=a.presentation??{};
  return [{part:'label',prefix:'label',actual:a.content,side:1},{part:'value',prefix:'answer',actual:'',side:-1}].flatMap(({part,prefix,actual,side})=>{
    const text=presentationText(properties,actual,prefix);if(!text)return [];
    const p=annotationTextPosition({...placement,text},scale,side);
    return [{...p,x:p.x+Number(properties[prefix+'OffsetX']??0),y:p.y+Number(properties[prefix+'OffsetY']??0),text,part,symbol:part==='label'}];
  });
}

function calculateBounds(
  document: CircuitDocument,
  options: NormalizedExportOptions,
  result?: SimulationResult,
): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const addRect = (x: number, y: number, width: number, height: number) => {
    for (const value of [x, y, width, height]) {
      if (!Number.isFinite(value)) throw new RangeError('Export bounds must be finite');
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  };
  const scale = circuitTextScale*(options.circuitOnly ? 1 : document.output?.fontScale ?? 1);
  const addText = (placement: TextPlacement) => {
    const width = (placement.blank ? 56 : estimatedTextWidth(placement.text)) * scale;
    addRect(placement.anchor === 'middle' ? placement.x - width / 2 : placement.x - 2, placement.y - 28*scale, width + 4, 46*scale);
  };

  for (const wire of document.wires) {
    for (const point of wirePoints(document, wire)) addRect(point.x - 3, point.y - 3, 6, 6);
  }
  for (const component of document.components) {
    const vertical = component.rotation % 180 !== 0;
    addRect(component.position.x - (vertical ? 28 : 48), component.position.y - (vertical ? 48 : 28), vertical ? 56 : 96, vertical ? 96 : 56);
    for (let index = 0; index < component.terminals.length; index += 1) {
      const terminal = terminalPosition(component, index);
      addRect(terminal.x - 5, terminal.y - 5, 10, 10);
    }
    for (const placement of componentTextPlacements(component, options.circuitOnly, result, scale, options.quantityFormat)) addText(placement);
  }
  for (const junction of document.junctions) addRect(junction.position.x - 6, junction.position.y - 6, 12, 12);

  if (document.referenceNode && options.showGround) {
    const point = endpointPosition(document, document.referenceNode);
    addRect(point.x - 11, point.y + 8, options.circuitOnly ? 30 + 32*scale : 22, options.circuitOnly ? 22 + 16*scale : 22);
  }

  for (const placement of (options.circuitOnly ? [] : annotationPlacements(document))) {
    if (placement.annotation.kind === 'arrow') for(const p of arrowGeometry(placement.annotation,placement).points) addRect(p.x-12,p.y-12,24,24);
    if (placement.annotation.kind === 'point') addRect(placement.x-5,placement.y-5,10,10);
    for(const label of annotationTextPlacements(placement,scale)) addText({...label,tone:'label',blank:label.text==='□'});
  }

  if (!Number.isFinite(minX)) {
    const empty = { x: 100 - options.margin, y: 100 - options.margin, width: 800 + 2 * options.margin, height: 500 + 2 * options.margin };
    ensureLogicalBounds(empty);
    return empty;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const contentWidth = Math.max(MIN_CONTENT_SIZE, maxX - minX);
  const contentHeight = Math.max(MIN_CONTENT_SIZE, maxY - minY);
  const bounds = {
    x: centerX - contentWidth / 2 - options.margin,
    y: centerY - contentHeight / 2 - options.margin,
    width: contentWidth + 2 * options.margin,
    height: contentHeight + 2 * options.margin,
  };
  ensureLogicalBounds(bounds);
  return bounds;
}

function ensureLogicalBounds(bounds: Bounds): void {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 ||
    bounds.width > MAX_LOGICAL_DIMENSION || bounds.height > MAX_LOGICAL_DIMENSION) {
    throw new RangeError('Export bounds are outside the supported range');
  }
}

function renderText(placement: TextPlacement, colors: ReturnType<typeof exportColors>, scale: number): string {
  const color = colors[placement.tone];
  if (placement.blank) return blankMarkup(placement.x, placement.y, placement.anchor, scale, color);
  return svgNotation(placement.text,{x:placement.x,y:placement.y,anchor:placement.anchor,fontSize:15*scale,weight:placement.tone==='label'?'650':'400',fill:color,symbol:placement.tone==='label'});
}
function blankMarkup(x: number, y: number, anchor: string, scale: number, color: string): string {
  return `<rect x="${numberAttribute(x-(anchor==='middle'?28*scale:0))}" y="${numberAttribute(y-18*scale)}" width="${56*scale}" height="${24*scale}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
}

function exportColors(monochrome: boolean) {
  if (monochrome) return { ink: '#111111', label: '#111111', value: '#111111', voltage: '#111111', current: '#111111', annotation: '#111111', reference: '#111111' } as const;
  return { ink: '#263548', label: '#344358', value: '#64758b', voltage: '#8d3d80', current: '#236f62', annotation: '#1d6288', reference: '#6a7c92' } as const;
}

export function createSvgExport(
  input: CircuitDocument,
  requestedOptions: ExportOptions = {},
  result?: SimulationResult,
): { svg: string; content: string; bounds: Bounds; options: NormalizedExportOptions } {
  const checked = validateDocument(input);
  if (!checked.ok) throw new DocumentError(checked.diagnostics);
  const document = checked.document;
  const options = normalizeOptions(requestedOptions);
  const bounds = calculateBounds(document, options, result);
  const colors = exportColors(options.monochrome);
  const symbolFill = options.background === 'white' ? '#ffffff' : 'none';
  const chunks: string[] = [];
  const fontDefinition = `<defs><style>${mathFontFace}</style></defs>`;
  const scale = circuitTextScale*(options.circuitOnly ? 1 : document.output?.fontScale ?? 1);

  chunks.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${numberAttribute(bounds.width)}" height="${numberAttribute(bounds.height)}" viewBox="${numberAttribute(bounds.x)} ${numberAttribute(bounds.y)} ${numberAttribute(bounds.width)} ${numberAttribute(bounds.height)}" role="img">`);
  chunks.push(`<title>${xmlText(document.title || '회로도')}</title>`);
  if (options.background === 'white') {
    chunks.push(`<rect x="${numberAttribute(bounds.x)}" y="${numberAttribute(bounds.y)}" width="${numberAttribute(bounds.width)}" height="${numberAttribute(bounds.height)}" fill="#ffffff"/>`);
  }
  chunks.push(`${fontDefinition}<g font-family="${mathFontFamily}" style="font-synthesis:none">`);

  const crossings=wireCrossings(document);
  for (const wire of document.wires) {
    chunks.push(`<path d="${wirePath(document, wire, crossings)}" fill="none" stroke="${colors.ink}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  for (const component of document.components) {
    chunks.push(`<g data-output-id="${xmlText(component.id)}" data-output-part="body" transform="translate(${numberAttribute(component.position.x)} ${numberAttribute(component.position.y)}) rotate(${component.rotation})" stroke="${colors.ink}" fill="${symbolFill}" stroke-width="2.5" color="${colors.ink}" stroke-linecap="round" stroke-linejoin="round">${symbolMarkup(component)}</g>`);
    for (const placement of componentTextPlacements(component, options.circuitOnly, result, scale, options.quantityFormat)) {
      chunks.push(`<g data-output-id="${xmlText(component.id)}" data-output-part="${placement.tone}">${renderText(placement, colors, scale)}</g>`);
    }
  }

  if (document.referenceNode && options.showGround) {
    const point = endpointPosition(document, document.referenceNode);
    chunks.push(`<g data-output-ground="true" transform="translate(${numberAttribute(point.x)} ${numberAttribute(point.y + 9)})" stroke="${colors.reference}" stroke-width="1.5" fill="none"><path d="M0 0V10 M-10 10H10 M-6 14H6 M-2 18H2"/>${options.circuitOnly?`<text x="16" y="16" fill="${colors.reference}" stroke="none" font-size="${11*scale}">0 V</text>`:''}</g>`);
  }

  for (const placement of (options.circuitOnly ? [] : annotationPlacements(document))) {
    const {annotation:a,x,y,text}=placement;
    chunks.push(`<g data-output-id="${xmlText(a.id)}" data-output-part="annotation">`);
    if(a.kind==='point') chunks.push(`<circle cx="${numberAttribute(x)}" cy="${numberAttribute(y)}" r="4" fill="${colors.annotation}"/>`);
    if(a.kind==='arrow') {
      const geometry=arrowGeometry(a,{x,y});
      chunks.push(`<path d="${geometry.path}" stroke="${colors.annotation}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${geometry.head}" fill="${colors.annotation}" stroke="${colors.annotation}" stroke-width="0.5" stroke-linejoin="round"/>`);
    }
    for(const label of annotationTextPlacements(placement,scale)) {
      const {x:tx,y:ty,anchor,text,part,symbol}=label;
      if(a.kind==='arrow')chunks.push(`<g data-output-id="${xmlText(a.id)}" data-output-part="${part}">`);
      if(text==='□') chunks.push(blankMarkup(tx,ty,anchor,scale,colors.annotation));
      else chunks.push(svgNotation(text,{x:tx,y:ty,anchor,fontSize:16*scale,fill:colors.annotation,symbol}));
      if(a.kind==='arrow')chunks.push('</g>');
    }
    chunks.push('</g>');
  }

  chunks.push('</g></svg>');
  const svg = chunks.join('');
  return { svg, content: svg.slice(svg.indexOf('>')+1, -6).replace(fontDefinition, ''), bounds, options };
}

export function exportSvg(document: CircuitDocument, options: ExportOptions = {}, result?: SimulationResult): string {
  return createSvgExport(document, options, result).svg;
}

async function loadSvgImage(blob: Blob): Promise<CanvasImageSource & { close?: () => void }> {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      return await globalThis.createImageBitmap(blob);
    } catch {
      // Some browsers cannot decode SVG with createImageBitmap; use an object URL there.
    }
  }
  if (typeof globalThis.Image !== 'function' || typeof globalThis.URL?.createObjectURL !== 'function') {
    throw new Error('SVG image decoding is not supported in this environment');
  }
  const url = globalThis.URL.createObjectURL(blob);
  try {
    const image = new globalThis.Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to decode the generated SVG'));
      image.src = url;
    });
    return image;
  } finally {
    globalThis.URL.revokeObjectURL(url);
  }
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Failed to encode PNG')), 'image/png');
  });
}

export async function exportPng(document: CircuitDocument, options: ExportOptions = {}, result?: SimulationResult): Promise<Blob> {
  const generated = createSvgExport(document, options, result);
  const width = Math.max(1, Math.ceil(generated.bounds.width) * generated.options.pngScale);
  const height = Math.max(1, Math.ceil(generated.bounds.height) * generated.options.pngScale);
  if (width > MAX_PIXEL_DIMENSION || height > MAX_PIXEL_DIMENSION || width * height > MAX_PIXEL_COUNT) {
    throw new RangeError('PNG dimensions are outside the supported range');
  }
  if (!globalThis.document?.createElement) throw new Error('PNG export requires a browser canvas');
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG export requires a 2D canvas');
  const source = await loadSvgImage(new Blob([generated.svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    context.drawImage(source, 0, 0, width, height);
  } finally {
    source.close?.();
  }
  return canvasPng(canvas);
}

export async function copyPng(document: CircuitDocument, options: ExportOptions = {}, result?: SimulationResult): Promise<{ copied: boolean; blob: Blob }> {
  const blob = await exportPng(document, options, result);
  const clipboard = globalThis.navigator?.clipboard;
  const ClipboardItemConstructor = globalThis.ClipboardItem;
  if (!clipboard?.write || typeof ClipboardItemConstructor !== 'function') return { copied: false, blob };
  try {
    await clipboard.write([new ClipboardItemConstructor({ 'image/png': blob })]);
    return { copied: true, blob };
  } catch {
    return { copied: false, blob };
  }
}
