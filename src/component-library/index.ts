import type { Annotation, CircuitDocument, ComponentInstance, ComponentType, EndpointRef, Point, Wire, SimulationResult } from '../domain';

export const componentDefinitions: Record<ComponentType, { name: string; short: string; unit: 'V' | 'Ω' | 'A' | ''; property?: string }> = {
  'dc-voltage-source': { name: '직류 전원', short: 'V', unit: 'V', property: 'voltageV' },
  resistor: { name: '저항', short: 'R', unit: 'Ω', property: 'resistanceOhm' },
  switch: { name: '스위치', short: 'S', unit: '' },
  ammeter: { name: '전류계', short: 'A', unit: 'A' },
  voltmeter: { name: '전압계', short: 'M', unit: 'V' },
  'resistive-load': { name: '저항성 부하', short: 'L', unit: 'Ω', property: 'resistanceOhm' },
};
export function createComponent(type: ComponentType, id: string, position: Point): ComponentInstance {
  const source = type === 'dc-voltage-source';
  return {
    id, type, label: id, position, rotation: source ? 90 : 0,
    properties: source ? { voltageV: 9 } : type === 'resistor' || type === 'resistive-load' ? { resistanceOhm: 10 } : type === 'switch' ? { state: 'open' } : {},
    terminals: [{ id: `${id}.a`, role: source ? 'positive' : 'a' }, { id: `${id}.b`, role: source ? 'negative' : 'b' }],
  };
}
export function terminalPosition(component: ComponentInstance, index: number): Point {
  const terminal = component.terminals[index];
  const first = component.type === 'dc-voltage-source' && component.terminals.some(t => t.role === 'positive') ? terminal?.role === 'positive' : index === 0;
  const p = terminal?.localPosition ?? { x: first ? -44 : 44, y: 0 };
  const angle = component.rotation * Math.PI / 180;
  return { x: component.position.x + Math.round(p.x * Math.cos(angle) - p.y * Math.sin(angle)), y: component.position.y + Math.round(p.x * Math.sin(angle) + p.y * Math.cos(angle)) };
}
export function endpointPosition(document: CircuitDocument, endpoint: EndpointRef): Point {
  if (endpoint.kind === 'junction') return document.junctions.find(j => j.id === endpoint.id)?.position ?? { x: 0, y: 0 };
  for (const c of document.components) {
    const i = c.terminals.findIndex(t => t.id === endpoint.id); if (i >= 0) return terminalPosition(c, i);
  }
  return { x: 0, y: 0 };
}
export function wirePoints(document: CircuitDocument, wire: Wire): Point[] {
  const start = endpointPosition(document, wire.start), end = endpointPosition(document, wire.end);
  return [start, ...(wire.waypoints.length ? wire.waypoints : start.x === end.x || start.y === end.y ? [] : [{ x: start.x, y: end.y }]), end];
}
export const pointsAttribute = (points: Point[]) => points.map(p => `${p.x},${p.y}`).join(' ');
export const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
export function formatQuantity(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return `— ${unit}`;
  if (Object.is(value, -0)) value = 0;
  const abs = Math.abs(value);
  const [scale, prefix] = abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'k'] : abs > 0 && abs < 1e-9 ? [1e-12, 'p'] : abs > 0 && abs < 1e-6 ? [1e-9, 'n'] : abs > 0 && abs < 1e-3 ? [1e-6, 'μ'] : abs > 0 && abs < 1 ? [1e-3, 'm'] : [1, ''];
  return `${value === 0 ? '0' : (value / Number(scale)).toPrecision(3)} ${prefix}${unit}`;
}
export function componentValue(component: ComponentInstance): string {
  const def = componentDefinitions[component.type];
  if (component.type === 'switch') return component.properties.state === 'closed' ? '닫힘' : '열림';
  return def.property ? formatQuantity(Number(component.properties[def.property]), def.unit) : def.name;
}
/** Shared schematic geometry for live SVG and independent print rendering. */
export function symbolMarkup(component: ComponentInstance): string {
  if (component.type === 'resistor' || component.type === 'resistive-load') return '<path d="M-44 0H-30L-25 -10 -15 10 -5 -10 5 10 15 -10 25 10 30 0H44" fill="none"/>';
  if (component.type === 'dc-voltage-source') return '<path d="M-44 0H-7 M7 0H44 M-7 -22V22 M7 -12V12"/><text x="-25" y="-12" stroke="none" fill="currentColor" font-size="15">+</text>';
  if (component.type === 'switch') return `<path d="M-44 0H-24 M24 0H44 M-22 0L22 ${component.properties.state === 'closed' ? 0 : -20}"/><circle cx="-24" cy="0" r="3"/><circle cx="24" cy="0" r="3"/>`;
  return `<path d="M-44 0H-23 M23 0H44"/><circle r="23"/><text x="0" y="6" text-anchor="middle" stroke="none" fill="currentColor" font-size="19">${component.type === 'ammeter' ? 'A' : 'V'}</text>`;
}
export function documentBounds(document: CircuitDocument, margin = 80) {
  const points = [...document.components.flatMap(c => [c.position, ...c.terminals.map((_, i) => terminalPosition(c, i))]), ...document.junctions.map(j => j.position), ...document.wires.flatMap(w => wirePoints(document, w))];
  if (!points.length) return { x: 100, y: 100, width: 800, height: 500 };
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
  return { x: minX - margin, y: minY - margin, width: Math.max(200, Math.max(...points.map(p => p.x)) - minX + 2 * margin), height: Math.max(200, Math.max(...points.map(p => p.y)) - minY + 2 * margin) };
}

export type WorksheetMode = 'problem' | 'answer';
export type NumberFormat = { kind: 'significant'; digits: number } | { kind: 'fixed'; digits: number } | { kind: 'integer' };
export function formatDisplayQuantity(value: number | undefined, unit: string, format: NumberFormat = { kind: 'significant', digits: 3 }): string {
  if (value === undefined || !Number.isFinite(value)) return `— ${unit}`;
  if (Object.is(value, -0)) value = 0;
  if (format.kind === 'integer') return `${Math.round(value)} ${unit}`;
  const digits = Math.max(format.kind === 'fixed' ? 0 : 1, Math.min(10, Math.trunc(Number.isFinite(format.digits) ? format.digits : 3)));
  if (format.kind === 'fixed') return `${value.toFixed(digits)} ${unit}`;
  const abs = Math.abs(value);
  const [scale, prefix] = abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'k'] : abs > 0 && abs < 1e-9 ? [1e-12, 'p'] : abs > 0 && abs < 1e-6 ? [1e-9, 'n'] : abs > 0 && abs < 1e-3 ? [1e-6, 'μ'] : abs > 0 && abs < 1 ? [1e-3, 'm'] : [1, ''];
  return `${value === 0 ? '0' : (value / Number(scale)).toPrecision(digits)} ${prefix}${unit}`;
}
export function componentPresentation(component: ComponentInstance, mode: WorksheetMode, result?: SimulationResult, numberFormat?: NumberFormat): { label: string | null; value: string | null; voltage: string | null; current: string | null } {
  const def = componentDefinitions[component.type];
  const value = def.property ? formatDisplayQuantity(Number(component.properties[def.property]), def.unit, numberFormat) : componentValue(component);
  const rule = (actual: string, prefix: string): string | null => {
    if (mode === 'answer') return actual;
    const display = component.properties[`${prefix}Display`] ?? 'value';
    return display === 'hidden' ? null : display === '?' ? '?' : display === 'blank' ? '________' : display === 'custom' ? String(component.properties[`${prefix}Text`] ?? 'x') : actual;
  };
  return {
    label: rule(component.label, 'label'), value: rule(value, 'answer'),
    voltage: component.properties.showVoltage === true ? rule(formatDisplayQuantity(result?.componentVoltages[component.id], 'V', numberFormat), 'voltage') : null,
    current: component.properties.showCurrent === true ? rule(formatDisplayQuantity(result?.branchCurrents[component.id], 'A', numberFormat), 'current') : null,
  };
}
export function annotationPresentation(annotation: Annotation, mode: WorksheetMode): string | null {
  if (annotation.visibility === 'hidden' || (annotation.visibility !== 'always' && annotation.visibility !== mode)) return null;
  return annotation.content || (annotation.kind === 'blank' ? '________' : annotation.kind === 'question' ? '?' : '');
}
export function annotationPlacements(document: CircuitDocument, mode: WorksheetMode): { annotation: Annotation; text: string; x: number; y: number }[] {
  const counts = new Map<string, number>();
  return document.annotations.flatMap(annotation => {
    const text = annotationPresentation(annotation, mode); if (text === null) return [];
    const index = counts.get(annotation.anchor.id) ?? 0; counts.set(annotation.anchor.id, index + 1);
    const p = endpointPosition(document, annotation.anchor);
    return [{ annotation, text, x: p.x + 12, y: p.y - 64 - index * 28 }];
  });
}
