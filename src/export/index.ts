import {
  annotationPlacements,
  componentPresentation,
  endpointPosition,
  escapeXml,
  pointsAttribute,
  symbolMarkup,
  terminalPosition,
  wirePoints,
  type NumberFormat,
  type WorksheetMode,
} from '../component-library';
import {
  DocumentError,
  validateDocument,
  type CircuitDocument,
  type ComponentInstance,
  type SimulationResult,
} from '../domain';

export type { NumberFormat, WorksheetMode } from '../component-library';

export type ExportBackground = 'transparent' | 'white';

export interface ExportOptions {
  mode?: WorksheetMode;
  monochrome?: boolean;
  background?: ExportBackground;
  margin?: number;
  pngScale?: number;
  numberFormat?: NumberFormat;
}

interface NormalizedExportOptions {
  mode: WorksheetMode;
  monochrome: boolean;
  background: ExportBackground;
  margin: number;
  pngScale: number;
  numberFormat: NumberFormat;
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
  tone: 'label' | 'value' | 'voltage' | 'current';
}

const DEFAULT_NUMBER_FORMAT: NumberFormat = { kind: 'significant', digits: 3 };
const MAX_LOGICAL_DIMENSION = 1_000_000;
const MAX_PIXEL_DIMENSION = 16_384;
const MAX_PIXEL_COUNT = 67_108_864;
const MIN_CONTENT_SIZE = 200;

function normalizeOptions(options: ExportOptions = {}): NormalizedExportOptions {
  const mode = options.mode ?? 'answer';
  const background = options.background ?? 'white';
  const monochrome = options.monochrome ?? false;
  const margin = options.margin ?? 48;
  const pngScale = options.pngScale ?? 2;
  const numberFormat = options.numberFormat ?? DEFAULT_NUMBER_FORMAT;

  if (mode !== 'problem' && mode !== 'answer') throw new TypeError('mode must be problem or answer');
  if (background !== 'transparent' && background !== 'white') throw new TypeError('background must be transparent or white');
  if (typeof monochrome !== 'boolean') throw new TypeError('monochrome must be a boolean');
  if (!Number.isFinite(margin) || margin < 0) throw new RangeError('margin must be a finite non-negative number');
  if (!Number.isFinite(pngScale) || pngScale <= 0) throw new RangeError('pngScale must be a finite positive number');
  if (numberFormat.kind === 'fixed') {
    if (!Number.isInteger(numberFormat.digits) || numberFormat.digits < 0 || numberFormat.digits > 10) {
      throw new RangeError('fixed digits must be an integer from 0 to 10');
    }
  } else if (numberFormat.kind === 'significant') {
    if (!Number.isInteger(numberFormat.digits) || numberFormat.digits < 1 || numberFormat.digits > 10) {
      throw new RangeError('significant digits must be an integer from 1 to 10');
    }
  } else if (numberFormat.kind !== 'integer') {
    throw new TypeError('numberFormat kind is invalid');
  }

  return { mode, monochrome, background, margin, pngScale, numberFormat };
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
  let width = 0;
  for (const character of text) {
    if (/\s/u.test(character)) width += 4.5;
    else width += (character.codePointAt(0) ?? 0) > 0xff ? 15.5 : 8.5;
  }
  return Math.max(8, width + 5);
}

function componentTextPlacements(
  component: ComponentInstance,
  mode: WorksheetMode,
  result: SimulationResult | undefined,
  numberFormat: NumberFormat,
): TextPlacement[] {
  const presentation = componentPresentation(component, mode, result, numberFormat);
  const vertical = component.rotation % 180 !== 0;
  const x = component.position.x + (vertical ? 34 : 0);
  const anchor = vertical ? 'start' : 'middle';
  const placements: TextPlacement[] = [];
  const add = (text: string | null, y: number, tone: TextPlacement['tone']) => {
    if (text !== null) placements.push({ text, x, y, anchor, tone });
  };

  if (vertical) {
    add(presentation.label, component.position.y - 18, 'label');
    add(presentation.value, component.position.y + 4, 'value');
    add(presentation.voltage === null ? null : `U = ${presentation.voltage}`, component.position.y + 26, 'voltage');
    add(presentation.current === null ? null : `I = ${presentation.current}`, component.position.y + 48, 'current');
  } else {
    add(presentation.label, component.position.y - 32, 'label');
    add(presentation.value, component.position.y + 42, 'value');
    add(presentation.voltage === null ? null : `U = ${presentation.voltage}`, component.position.y + 64, 'voltage');
    add(presentation.current === null ? null : `I = ${presentation.current}`, component.position.y + 86, 'current');
  }
  return placements;
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
  const addText = (placement: TextPlacement) => {
    const width = estimatedTextWidth(placement.text);
    addRect(placement.anchor === 'middle' ? placement.x - width / 2 : placement.x - 2, placement.y - 18, width + 4, 24);
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
    for (const placement of componentTextPlacements(component, options.mode, result, options.numberFormat)) addText(placement);
  }
  for (const junction of document.junctions) addRect(junction.position.x - 6, junction.position.y - 6, 12, 12);

  if (document.referenceNode) {
    const point = endpointPosition(document, document.referenceNode);
    addRect(point.x - 11, point.y + 8, 55, 31);
  }

  for (const placement of annotationPlacements(document, options.mode)) {
    const width = estimatedTextWidth(placement.text);
    if (placement.annotation.kind === 'arrow') {
      addRect(placement.x - 2, placement.y - 14, 52 + width, 22);
    } else {
      addRect(placement.x - 2, placement.y - 18, width + 4, 24);
    }
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

function renderText(placement: TextPlacement, colors: ReturnType<typeof exportColors>): string {
  const color = colors[placement.tone];
  const weight = placement.tone === 'label' ? '650' : '400';
  return `<text x="${numberAttribute(placement.x)}" y="${numberAttribute(placement.y)}" text-anchor="${placement.anchor}" font-size="15" font-weight="${weight}" fill="${color}">${xmlText(placement.text)}</text>`;
}

function exportColors(monochrome: boolean) {
  if (monochrome) return { ink: '#111111', label: '#111111', value: '#111111', voltage: '#111111', current: '#111111', annotation: '#111111', reference: '#111111' } as const;
  return { ink: '#263548', label: '#344358', value: '#64758b', voltage: '#8d3d80', current: '#236f62', annotation: '#1d6288', reference: '#6a7c92' } as const;
}

function createSvgExport(
  input: CircuitDocument,
  requestedOptions: ExportOptions = {},
  result?: SimulationResult,
): { svg: string; bounds: Bounds; options: NormalizedExportOptions } {
  const checked = validateDocument(input);
  if (!checked.ok) throw new DocumentError(checked.diagnostics);
  const document = checked.document;
  const options = normalizeOptions(requestedOptions);
  const bounds = calculateBounds(document, options, result);
  const colors = exportColors(options.monochrome);
  const symbolFill = options.background === 'white' ? '#ffffff' : 'none';
  const chunks: string[] = [];

  chunks.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${numberAttribute(bounds.width)}" height="${numberAttribute(bounds.height)}" viewBox="${numberAttribute(bounds.x)} ${numberAttribute(bounds.y)} ${numberAttribute(bounds.width)} ${numberAttribute(bounds.height)}" role="img">`);
  chunks.push(`<title>${xmlText(document.title || '회로도')}</title>`);
  if (options.background === 'white') {
    chunks.push(`<rect x="${numberAttribute(bounds.x)}" y="${numberAttribute(bounds.y)}" width="${numberAttribute(bounds.width)}" height="${numberAttribute(bounds.height)}" fill="#ffffff"/>`);
  }
  chunks.push('<g font-family="Arial, sans-serif">');

  for (const wire of document.wires) {
    chunks.push(`<polyline points="${pointsAttribute(wirePoints(document, wire))}" fill="none" stroke="${colors.ink}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  for (const component of document.components) {
    chunks.push(`<g transform="translate(${numberAttribute(component.position.x)} ${numberAttribute(component.position.y)}) rotate(${component.rotation})" stroke="${colors.ink}" fill="${symbolFill}" stroke-width="2.5" color="${colors.ink}" stroke-linecap="round" stroke-linejoin="round">${symbolMarkup(component)}</g>`);
    for (let index = 0; index < component.terminals.length; index += 1) {
      const point = terminalPosition(component, index);
      chunks.push(`<circle cx="${numberAttribute(point.x)}" cy="${numberAttribute(point.y)}" r="3.5" fill="${colors.ink}"/>`);
    }
    for (const placement of componentTextPlacements(component, options.mode, result, options.numberFormat)) {
      chunks.push(renderText(placement, colors));
    }
  }

  for (const junction of document.junctions) {
    chunks.push(`<circle cx="${numberAttribute(junction.position.x)}" cy="${numberAttribute(junction.position.y)}" r="5" fill="${colors.ink}"/>`);
  }

  if (document.referenceNode) {
    const point = endpointPosition(document, document.referenceNode);
    chunks.push(`<g transform="translate(${numberAttribute(point.x)} ${numberAttribute(point.y + 9)})" stroke="${colors.reference}" stroke-width="1.5" fill="none"><path d="M0 0V10 M-10 10H10 M-6 14H6 M-2 18H2"/><text x="16" y="16" fill="${colors.reference}" stroke="none" font-size="11">0 V</text></g>`);
  }

  for (const placement of annotationPlacements(document, options.mode)) {
    const x = numberAttribute(placement.x);
    const y = numberAttribute(placement.y);
    if (placement.annotation.kind === 'arrow') {
      chunks.push(`<g stroke="${colors.annotation}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M${x} ${numberAttribute(placement.y - 5)}H${numberAttribute(placement.x + 40)} M${numberAttribute(placement.x + 32)} ${numberAttribute(placement.y - 11)}L${numberAttribute(placement.x + 40)} ${numberAttribute(placement.y - 5)} ${numberAttribute(placement.x + 32)} ${numberAttribute(placement.y + 1)}"/></g>`);
      if (placement.text) chunks.push(`<text x="${numberAttribute(placement.x + 48)}" y="${y}" font-size="16" fill="${colors.annotation}">${xmlText(placement.text)}</text>`);
    } else if (placement.text) {
      chunks.push(`<text x="${x}" y="${y}" font-size="16" fill="${colors.annotation}">${xmlText(placement.text)}</text>`);
    }
  }

  chunks.push('</g></svg>');
  return { svg: chunks.join(''), bounds, options };
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
  const width = Math.max(1, Math.ceil(generated.bounds.width * generated.options.pngScale));
  const height = Math.max(1, Math.ceil(generated.bounds.height * generated.options.pngScale));
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
