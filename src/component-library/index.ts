export { arrowStyle, arrowGeometry, resizeArrow } from './arrows';
import { storedFraction, notationTokens, symbolGlyphs } from '../notation';
import type { Annotation, CircuitDocument, ComponentInstance, ComponentType, EndpointRef, Point, Wire, SimulationResult } from '../domain';

export const componentDefinitions: Record<ComponentType, { name: string; short: string; unit: 'V' | 'Ω' | 'A' | ''; property?: string }> = {
  'dc-voltage-source': { name: '직류 전원', short: 'V', unit: 'V', property: 'voltageV' },
  resistor: { name: '저항', short: 'R', unit: 'Ω', property: 'resistanceOhm' },
  switch: { name: '스위치', short: 'S', unit: '' },
  ammeter: { name: '전류계', short: 'A', unit: 'A' },
  voltmeter: { name: '전압계', short: 'M', unit: 'V' },
  'resistive-load': { name: '가변저항', short: 'VR', unit: 'Ω', property: 'resistanceOhm' },
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
export interface WireCrossing { point: Point; horizontalId: string; verticalId: string; horizontalSegment: number; verticalSegment: number }
/** Geometry is only a hit target / drawing aid; electrical connections still use IDs. */
export function compactWirePoints(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.at(-1)?.x === p.x && result.at(-1)?.y === p.y) continue;
    while (result.length >= 2) {
      const a = result.at(-2)!, b = result.at(-1)!;
      if ((a.x === b.x && b.x === p.x && (b.y-a.y)*(p.y-b.y)>=0) || (a.y === b.y && b.y === p.y && (b.x-a.x)*(p.x-b.x)>=0)) result.pop();
      else break;
    }
    result.push(p);
  }
  return result;
}
export function wireCrossings(document: CircuitDocument): WireCrossing[] {
  const segments = document.wires.flatMap(w => {
    const points = compactWirePoints(wirePoints(document, w));
    return points.slice(1).map((b, i) => ({ id: w.id, a: points[i], b, i }));
  });
  const crossings: WireCrossing[] = [];
  for (const h of segments.filter(s => s.a.y === s.b.y)) for (const v of segments.filter(s => s.a.x === s.b.x)) {
    if (h.id === v.id) continue;
    const p = { x: v.a.x, y: h.a.y };
    if (p.x > Math.min(h.a.x,h.b.x) && p.x < Math.max(h.a.x,h.b.x) && p.y > Math.min(v.a.y,v.b.y) && p.y < Math.max(v.a.y,v.b.y)) {
      crossings.push({ point:p, horizontalId:h.id, verticalId:v.id, horizontalSegment:h.i, verticalSegment:v.i });
    }
  }
  return crossings.sort((a,b)=>a.point.x-b.point.x || a.point.y-b.point.y || a.horizontalId.localeCompare(b.horizontalId));
}
/** Horizontal wires bridge vertical wires. No opaque mask, including transparent PNG/SVG. */
export function wirePath(document: CircuitDocument, wire: Wire, crossings = wireCrossings(document)): string {
  const points = compactWirePoints(wirePoints(document, wire));
  let path = `M${points[0].x} ${points[0].y}`;
  for (let i=0;i<points.length-1;i++) {
    const a=points[i], b=points[i+1], direction=Math.sign(b.x-a.x);
    const hits = [...new Set(crossings.filter(c=>c.horizontalId===wire.id && c.horizontalSegment===i).map(c=>c.point.x))].sort((x,y)=>direction*(x-y));
    hits.forEach((x,j)=>{
      const radius=Math.min(7,Math.abs(x-a.x)/2,Math.abs(x-b.x)/2,j?Math.abs(x-hits[j-1])/3:7,j<hits.length-1?Math.abs(x-hits[j+1])/3:7);
      path+=` L${x-direction*radius} ${a.y} A${radius} ${radius} 0 0 ${direction>0?1:0} ${x+direction*radius} ${a.y}`;
    });
    path+=` L${b.x} ${b.y}`;
  }
  return path;
}
export function endpointName(document: CircuitDocument, id: string): string {
  for (const c of document.components) {
    const i=c.terminals.findIndex(t=>t.id===id);
    if(i<0)continue;
    const t=c.terminals[i], p=terminalPosition(c,i), other=terminalPosition(c,i===0?1:0);
    return `${c.label} · ${t.role==='positive'?'＋극':t.role==='negative'?'−극':p.x!==other.x?(p.x<other.x?'왼쪽':'오른쪽'):(p.y<other.y?'위쪽':'아래쪽')} 단자`;
  }
  return document.junctions.some(j=>j.id===id) ? `분기점 ${id}` : id;
}
export const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
export function formatQuantity(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return `— ${unit}`;
  if (Object.is(value, -0)) value = 0;
  const abs = Math.abs(value);
  const [scale, prefix] = abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'k'] : abs > 0 && abs < 1e-9 ? [1e-12, 'p'] : abs > 0 && abs < 1e-6 ? [1e-9, 'n'] : abs > 0 && abs < 1e-3 ? [1e-6, 'μ'] : abs > 0 && abs < 1 ? [1e-3, 'm'] : [1, ''];
  return `${value === 0 ? '0' : Number((value / Number(scale)).toFixed(2))} ${prefix}${unit}`;
}
export function componentValue(component: ComponentInstance): string {
  const def = componentDefinitions[component.type];
  if (component.type === 'switch') return component.properties.state === 'closed' ? '닫힘' : '열림';
  const fraction=def.property?storedFraction(component.properties,def.property,def.unit):undefined;
  return fraction ? `${fraction} ${def.unit}` : def.property ? formatQuantity(Number(component.properties[def.property]), def.unit) : def.name;
}
/** Shared schematic geometry for live SVG and independent print rendering. */
export function symbolMarkup(component: ComponentInstance, options: { disconnectedSource?: boolean } = {}): string {
  if (component.type === 'resistor' || component.type === 'resistive-load') {
    const resistor='<path d="M-44 0H-30L-25 -10 -15 10 -5 -10 5 10 15 -10 25 10 30 0H44" fill="none"/>';
    return resistor+(component.type==='resistive-load'?'<path data-symbol="adjustment-arrow" d="M-18 20L18 -20 M8 -18L18 -20 17 -10" fill="none"/>':'');
  }
  if (component.type === 'dc-voltage-source') return `<path d="M-${options.disconnectedSource?32:44} 0H-7 M7 0H${options.disconnectedSource?32:44} M-7 -22V22 M7 -12V12"/><text x="-25" y="-12" stroke="none" fill="currentColor" font-size="15">+</text>`;
  if (component.type === 'switch') return `<path d="M-44 0H-24 M24 0H44 M-22 0L22 ${component.properties.state === 'closed' ? 0 : -20}"/><circle cx="-24" cy="0" r="3"/><circle cx="24" cy="0" r="3"/>`;
  return `<path d="M-44 0H-23 M23 0H44"/><circle r="23"/><text x="0" y="6" text-anchor="middle" stroke="none" fill="currentColor" font-size="19">${component.type === 'ammeter' ? 'A' : 'V'}</text>`;
}
export function documentBounds(document: CircuitDocument, margin = 80) {
  const points = [...document.components.flatMap(c => [c.position, ...c.terminals.map((_, i) => terminalPosition(c, i))]), ...document.junctions.map(j => j.position), ...document.wires.flatMap(w => wirePoints(document, w))];
  if (!points.length) return { x: 100, y: 100, width: 800, height: 500 };
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
  return { x: minX - margin, y: minY - margin, width: Math.max(200, Math.max(...points.map(p => p.x)) - minX + 2 * margin), height: Math.max(200, Math.max(...points.map(p => p.y)) - minY + 2 * margin) };
}

/** Output numbers use base units, at most two decimal places, and no trailing zeroes. */
export function formatDisplayQuantity(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return `— ${unit}`;
  return `${Number(value.toFixed(2))} ${unit}`;
}
export function presentationText(properties:Record<string,string|number|boolean>,actual:string,prefix:string):string|null {
    const display = properties[`${prefix}Display`] ?? 'value';
    if (properties[`${prefix}Visible`] === false || display === 'hidden') return null;
    if (properties[`${prefix}Blank`] === true) return '□';
    return display === 'hidden' ? null : display === '?' ? '?' : display === 'blank' ? '□' : display === 'custom' ? String(properties[`${prefix}Text`] ?? 'x') : actual;
}
export function componentPresentation(component: ComponentInstance, result?: SimulationResult): { label: string | null; value: string | null; voltage: string | null; current: string | null } {
  const def = componentDefinitions[component.type];
  const fraction=def.property?storedFraction(component.properties,def.property,def.unit):undefined;
  const value = fraction ? `${fraction} ${def.unit}` : def.property ? formatDisplayQuantity(Number(component.properties[def.property]), def.unit) : componentValue(component);
  const rule=(actual:string,prefix:string)=>presentationText(component.properties,actual,prefix);
  return {
    label: rule(component.label, 'label'), value: rule(value, 'answer'),
    voltage: component.properties.showVoltage === true ? rule(formatDisplayQuantity(result?.componentVoltages[component.id], 'V'), 'voltage') : null,
    current: component.properties.showCurrent === true ? rule(formatDisplayQuantity(result?.branchCurrents[component.id], 'A'), 'current') : null,
  };
}
export function annotationPresentation(annotation: Annotation): string | null {
  if (annotation.visibility === 'hidden') return null;
  return annotation.content || (annotation.kind === 'blank' ? '□' : annotation.kind === 'question' ? '?' : '');
}
export function annotationPlacements(document: CircuitDocument): { annotation: Annotation; text: string; x: number; y: number }[] {
  const counts = new Map<string, number>();
  return document.annotations.flatMap(annotation => {
    const text = annotationPresentation(annotation); if (text === null) return [];
    if (annotation.position) return [{annotation, text, ...annotation.position}];
    if (!annotation.anchor) return [];
    const index = counts.get(annotation.anchor.id) ?? 0; counts.set(annotation.anchor.id, index + 1);
    const p = endpointPosition(document, annotation.anchor);
    return [{ annotation, text, x: p.x + 12, y: p.y - 64 - index * 28 }];
  });
}

/** Raw edit string retains intentional fractions; generated calculation values do not acquire them. */
export function componentValueInput(component: ComponentInstance): string {
  const def=componentDefinitions[component.type];
  return def.property ? storedFraction(component.properties,def.property,def.unit) ?? String(component.properties[def.property]) : '';
}

export function notationWidth(text:string,fontSize:number):number {
  return notationTokens(text).reduce((sum,token)=>sum+(token.kind==='subscript'?notationWidth(token.text,fontSize*.7)/fontSize:token.kind==='fraction'?Math.max(token.numerator.length,token.denominator.length)*.64+.4:[...token.text].reduce((n,c)=>n+(c===' '?.3:c.codePointAt(0)!>255?1.05:/[MW@]/.test(c)?.9:.58),0))*fontSize,0);
}
export function svgNotation(text:string,options:{x:number;y:number;fontSize:number;anchor?:'start'|'middle';fill?:string;weight?:string;symbol?:boolean}):string {
  const {x,y,fontSize,anchor='start',fill='currentColor',weight='400'}=options;
  const clean=(value:string)=>escapeXml(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'�'));
  const tokens=notationTokens(text);
  const written=(value:string)=>clean(options.symbol||/^[A-Za-zΑ-Ωα-ω][A-Za-zΑ-Ωα-ω0-9_]*\s*[=≈]/.test(value)?symbolGlyphs(value):value);
  if(tokens.every(t=>t.kind==='text'))return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${written(text)}</text>`;
  let cursor=x-(anchor==='middle'?notationWidth(text,fontSize)/2:0);
  const parts:string[]=[];
  for(const token of tokens){
    if(token.kind==='text'){
      parts.push(`<text x="${cursor}" y="${y}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" xml:space="preserve">${written(token.text)}</text>`);
      cursor+=notationWidth(token.text,fontSize);
    }else if(token.kind==='subscript'){
      parts.push(`<text data-notation="subscript" x="${cursor}" y="${y+.28*fontSize}" font-size="${fontSize*.7}" font-weight="${weight}" fill="${fill}">${written(token.text)}</text>`);
      cursor+=notationWidth(token.text,fontSize*.7);
    }else{
      const width=(Math.max(token.numerator.length,token.denominator.length)*.64+.4)*fontSize, center=cursor+width/2;
      parts.push(`<g aria-label="${clean(token.numerator+'/'+token.denominator)}"><text x="${center}" y="${y-.65*fontSize}" text-anchor="middle" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${clean(token.numerator)}</text><path d="M${cursor+.05*fontSize} ${y-.35*fontSize}H${cursor+width-.05*fontSize}" stroke="${fill}" stroke-width="${Math.max(.8,fontSize*.055)}"/><text x="${center}" y="${y+.75*fontSize}" text-anchor="middle" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${clean(token.denominator)}</text></g>`);
      cursor+=width;
    }
  }
  return parts.join('');
}

/** Safe HTML counterpart for notation outside SVG, including projected 3D labels. */
export function htmlNotation(text:string,symbol=false):string {
  const written=(value:string)=>escapeXml(symbol?symbolGlyphs(value):value);
  return notationTokens(text).map(t=>t.kind==='text'?written(t.text):t.kind==='subscript'?`<sub>${written(t.text)}</sub>`:`<span class="notation-fraction" aria-hidden="true"><span>${escapeXml(t.numerator)}</span><span>${escapeXml(t.denominator)}</span></span>`).join('');
}

export const circuitTextScale = 1.5;
export function notationMetrics(text:string|null,fontSize:number) {
  const fraction=notationTokens(text??'').some(t=>t.kind==='fraction');
  return {width:notationWidth(text??'',fontSize),ascent:fontSize*(fraction?1.65:1),descent:fontSize*(fraction?.8:.35)};
}
/** Font-aware default positions shared by live circuit labels and independent output. */
export function componentNotationLayout(component:ComponentInstance,label:string|null,value:string|null,fontSize:number) {
  const vertical=component.rotation%180!==0,gap=Math.max(9,fontSize*.45);
  const name=notationMetrics(label,fontSize),quantity=notationMetrics(value,fontSize);
  const x=component.position.x+(vertical?28+gap:0),anchor=vertical?'start' as const:'middle' as const;
  const total=name.ascent+name.descent+gap+quantity.ascent+quantity.descent;
  const horizontalGap=Math.max(6,fontSize*.3),symbolHeight=component.type==='resistor'?14:24;
  const labelY=vertical?component.position.y-total/2+name.ascent:component.position.y-symbolHeight-horizontalGap-name.descent;
  const valueY=vertical?labelY+name.descent+gap+quantity.ascent:component.position.y+symbolHeight+horizontalGap+quantity.ascent;
  const voltageY=valueY+quantity.descent+gap+fontSize;
  return {label:{x,y:labelY,anchor},value:{x,y:valueY,anchor},voltage:{x,y:voltageY,anchor},current:{x,y:voltageY+fontSize*1.35+gap,anchor}};
}
