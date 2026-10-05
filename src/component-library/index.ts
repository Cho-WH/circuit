import type { ComponentProperties } from '../domain';
import * as q from '../rational';
import { isStoredScalar, defaultOperatingProfileRef } from '../domain';
import { quantityInput, storedFraction, formatQuantity, quantityFormatFor, type QuantityFormatOptions } from '../quantity';
export { arrowStyle, arrowGeometry, resizeArrow } from './arrows';
export { parameterValueAt, adjustableParameter, type AdjustableParameter } from './parameters';
import { compactWirePoints } from '../wire-geometry';
export { compactWirePoints } from '../wire-geometry';
import { notationTokens, notationDisplayText } from '../notation';
import type { Annotation, CircuitDocument, ComponentInstance, ComponentType, EndpointRef, Point, Wire, SimulationResult } from '../domain';

export const componentDefinitions: Record<ComponentType, { name: string; short: string; unit: 'V' | 'Ω' | 'A' | ''; property?: string }> = {
  'dc-voltage-source': { name: '직류 전원', short: 'V', unit: 'V', property: 'voltageV' },
  resistor: { name: '저항', short: 'R', unit: 'Ω', property: 'resistanceOhm' },
  switch: { name: '스위치', short: 'S', unit: '' },
  ammeter: { name: '전류계', short: 'A', unit: 'A' },
  voltmeter: { name: '전압계', short: 'M', unit: 'V' },
  'resistive-load': { name: '가변저항', short: 'VR', unit: 'Ω', property: 'resistanceOhm' },
  diode: { name: '다이오드', short: 'D', unit: 'V' },
};
export function createComponent(type: ComponentType, id: string, position: Point): ComponentInstance {
  const source = type === 'dc-voltage-source';
  const operatingProfile = defaultOperatingProfileRef(type);
  return {
    id, type, label: type === 'resistive-load' ? id.replace(/^VR(\d+)$/, 'VR_$1') : id, position, rotation: source ? 90 : 0,
    properties: source ? { voltageV: q.store(9) } : type === 'resistive-load' ? { resistanceOhm: q.store(10), resistanceMinOhm: q.store(1), resistanceMaxOhm: q.store(100) } : type === 'resistor' ? { resistanceOhm: q.store(10) } : type === 'switch' ? { state: 'open' } : {},
    ...(operatingProfile ? { operatingProfile } : {}),
    terminals: [{ id: `${id}.a`, role: source ? 'positive' : type === 'diode' ? 'anode' : 'a' }, { id: `${id}.b`, role: source ? 'negative' : type === 'diode' ? 'cathode' : 'b' }],
  };
}
export function terminalPosition(component: ComponentInstance, index: number): Point {
  const terminal = component.terminals[index];
  const first = component.type === 'diode' ? terminal?.role === 'anode' : component.type === 'dc-voltage-source' && component.terminals.some(t => t.role === 'positive') ? terminal?.role === 'positive' : index === 0;
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
function wireRoute(document: CircuitDocument, wire: Wire, crossings: WireCrossing[]) {
  const points = compactWirePoints(wirePoints(document, wire));
  const sections: { end: Point; radius?: number; direction?: number }[] = [];
  for (let i=0;i<points.length-1;i++) {
    const a=points[i], b=points[i+1], direction=Math.sign(b.x-a.x);
    const hits = [...new Set(crossings.filter(c=>c.horizontalId===wire.id && c.horizontalSegment===i).map(c=>c.point.x))].sort((x,y)=>direction*(x-y));
    hits.forEach((x,j)=>{
      const radius=Math.min(7,Math.abs(x-a.x)/2,Math.abs(x-b.x)/2,j?Math.abs(x-hits[j-1])/3:7,j<hits.length-1?Math.abs(x-hits[j+1])/3:7);
      sections.push({end:{x:x-direction*radius,y:a.y}}, {end:{x:x+direction*radius,y:a.y},radius,direction});
    });
    sections.push({end:b});
  }
  return {start:points[0],sections};
}
/** Horizontal wires bridge vertical wires. No opaque mask, including transparent PNG/SVG. */
export function wirePath(document: CircuitDocument, wire: Wire, crossings = wireCrossings(document)): string {
  const {start,sections}=wireRoute(document,wire,crossings);
  return `M${start.x} ${start.y}`+sections.map(({end,radius,direction})=>radius!==undefined?` A${radius} ${radius} 0 0 ${direction!>0?1:0} ${end.x} ${end.y}`:` L${end.x} ${end.y}`).join('');
}
/** The same display bridges sampled for projection/flow, without inferring connectivity. */
export function wireDisplayPoints(document:CircuitDocument,wire:Wire,crossings=wireCrossings(document)):Point[] {
  const {start,sections}=wireRoute(document,wire,crossings), points=[start];
  for(const section of sections) {
    if(section.radius!==undefined) {
      const {end,radius,direction}=section,center=end.x-direction!*radius;
      for(let step=1;step<12;step++) {
        const t=step/12;
        points.push({x:center-direction!*radius*Math.cos(t*Math.PI),y:end.y-radius*Math.sin(t*Math.PI)});
      }
    }
    points.push(section.end);
  }
  return points;
}
function terminalName(document: CircuitDocument, id: string): string | undefined {
  for (const c of document.components) {
    const i=c.terminals.findIndex(t=>t.id===id);
    if(i<0)continue;
    const t=c.terminals[i], p=terminalPosition(c,i), other=terminalPosition(c,i===0?1:0);
    return `${c.label} · ${t.role==='positive'?'＋극':t.role==='negative'?'−극':t.role==='anode'?'A':t.role==='cathode'?'K':Math.abs(p.x-other.x)>=Math.abs(p.y-other.y)?(p.x<other.x?'왼쪽':'오른쪽'):(p.y<other.y?'위쪽':'아래쪽')} 단자`;
  }
  return undefined;
}

/** Walk explicit wire connections only, stopping at the first layer of terminals.
 * Coordinates describe a terminal's visible side; they never decide connectivity.
 */
function neighboringTerminals(document: CircuitDocument, id: string): string[] {
  const terminalIds = new Set(document.components.flatMap(c => c.terminals.map(t => t.id)));
  const neighbors = new Map<string, string[]>();
  for (const wire of document.wires) {
    for (const [a, b] of [[wire.start.id, wire.end.id], [wire.end.id, wire.start.id]]) {
      if (!neighbors.has(a)) neighbors.set(a, []);
      neighbors.get(a)!.push(b);
    }
  }
  const visited = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const point of frontier) for (const neighbor of neighbors.get(point) ?? []) {
      if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
    }
    const terminals = next.filter(point => terminalIds.has(point));
    if (terminals.length) return terminals.sort();
    frontier = next;
  }
  return [];
}

const compactTerminalName = (name: string) => name.replace(' · ', ' ').replace(' 단자', '');

export function endpointName(document: CircuitDocument, id: string): string {
  const direct = terminalName(document, id);
  if (direct) return direct;
  if (!document.junctions.some(j => j.id === id)) return '연결 위치';
  const nearby = neighboringTerminals(document, id);
  const source = nearby.find(point => document.components.some(c =>
    c.type === 'dc-voltage-source' && c.terminals.some(t => t.id === point)));
  if (source) return `${compactTerminalName(terminalName(document, source)!)} 쪽 연결점`;
  if (nearby.length === 2) {
    const components = nearby.map(point => document.components.find(c => c.terminals.some(t => t.id === point))!);
    if (components[0].id === components[1].id) return `${components[0].label} 양단 연결점`;
    const sides = nearby.map(point => terminalName(document, point)!.split(' · ').at(-1)!.replace(' 단자', ''));
    return `${components.map(c => c.label).join('·')} ${sides[0] === sides[1] ? sides[0] : '사이'} 연결점`;
  }
  return nearby.length ? `${compactTerminalName(terminalName(document, nearby[0])!)} 연결점` : '연결점';
}

/** A wire is described by the visible component it joins, never by its storage ID. */
export function wireName(document: CircuitDocument, id: string): string {
  const wire = document.wires.find(w => w.id === id);
  if (!wire) return '도선';
  const ends = [wire.start.id, wire.end.id];
  const direct = ends.flatMap(point => {
    const name = terminalName(document, point);
    return name ? [compactTerminalName(name)] : [];
  });
  if (direct.length) return `${direct.join(' — ')} 도선`;
  const names = [...new Set(ends.map(point => endpointName(document, point)))];
  return `${names.join(' — ')} 연결 도선`;
}
export const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
export function componentValue(component: ComponentInstance, options?: QuantityFormatOptions): string {
  options=quantityFormatFor(component.properties,options);
  const def = componentDefinitions[component.type];
  if (component.type === 'diode') return formatQuantity(q.rational(7n, 10n), 'V', options);
  if (component.type === 'switch') return component.properties.state === 'closed' ? '닫힘' : '열림';
  const fraction=def.property?storedFraction(component.properties,def.property,def.unit):undefined;
  return fraction && (!options?.mode || options.mode==='auto') ? `${fraction} ${def.unit}` : def.property ? formatQuantity(isStoredScalar(component.properties[def.property]) ? component.properties[def.property] as q.StoredScalar : undefined, def.unit, options) : def.name;
}
/** Shared schematic geometry for live SVG and independent print rendering. */
export function symbolMarkup(component: ComponentInstance, options: { disconnectedSource?: boolean } = {}): string {
  if (component.type === 'diode') return '<path d="M-44 0H-16 M16 0H44 M-16 -18L16 0 -16 18Z M16 -18V18" fill="none"/><text x="-30" y="-10" stroke="none" fill="currentColor" font-size="11" text-anchor="middle">A</text><text x="30" y="-10" stroke="none" fill="currentColor" font-size="11" text-anchor="middle">K</text>';
  if (component.type === 'resistor' || component.type === 'resistive-load') {
    const resistor='<path d="M-44 0H-30L-25 -10 -15 10 -5 -10 5 10 15 -10 25 10 30 0H44" fill="none"/>';
    return resistor+(component.type==='resistive-load'?'<path data-symbol="adjustment-arrow" d="M-18 20L18 -20 M8 -18L18 -20 17 -10" fill="none"/>':'');
  }
  if (component.type === 'dc-voltage-source') return `<path d="M-${options.disconnectedSource?32:44} 0H-7 M7 0H${options.disconnectedSource?32:44} M-7 -22V22"/><path d="M7 -12V12" stroke-width="5" stroke-linecap="butt"/><text x="-25" y="-12" stroke="none" fill="currentColor" font-size="15">+</text>`;
  if (component.type === 'switch') return `<path d="M-44 0H-24 M24 0H44 M-22 0L22 ${component.properties.state === 'closed' ? 0 : -20}"/><circle cx="-24" cy="0" r="3"/><circle cx="24" cy="0" r="3"/>`;
  return `<path d="M-44 0H-23 M23 0H44"/><circle r="23"/><text x="0" y="6" text-anchor="middle" stroke="none" fill="currentColor" font-size="19">${component.type === 'ammeter' ? 'A' : 'V'}</text>`;
}
export function documentBounds(document: CircuitDocument, margin = 80) {
  const points = [...document.components.flatMap(c => [c.position, ...c.terminals.map((_, i) => terminalPosition(c, i))]), ...document.junctions.map(j => j.position), ...document.wires.flatMap(w => wirePoints(document, w))];
  if (!points.length) return { x: 100, y: 100, width: 800, height: 500 };
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
  return { x: minX - margin, y: minY - margin, width: Math.max(200, Math.max(...points.map(p => p.x)) - minX + 2 * margin), height: Math.max(200, Math.max(...points.map(p => p.y)) - minY + 2 * margin) };
}

export function presentationText(properties:ComponentProperties,actual:string,prefix:string):string|null {
    const display = properties[`${prefix}Display`] ?? 'value';
    if (properties[`${prefix}Visible`] === false || display === 'hidden') return null;
    if (properties[`${prefix}Blank`] === true) return '□';
    return display === 'hidden' ? null : display === '?' ? '?' : display === 'blank' ? '□' : display === 'custom' ? String(properties[`${prefix}Text`] ?? 'x') : actual;
}
export function componentPresentation(component: ComponentInstance, result?: SimulationResult, options?: QuantityFormatOptions): { label: string | null; value: string | null; voltage: string | null; current: string | null } {
  options=quantityFormatFor(component.properties,options);
  const value = componentValue(component, options);
  const resultOptions={...options,modelApproximation:result?.provenance?.physicalModel==='component'};
  const rule=(actual:string,prefix:string)=>component.properties[prefix+'Visible']===false ? null : component.properties[prefix+'Blank']===true ? '□' : actual;
  return {
    label: rule(component.label, 'label'), value: rule(value, 'answer'),
    voltage: component.properties.showVoltage === true ? rule(formatQuantity(result?.componentVoltages[component.id], 'V', resultOptions), 'voltage') : null,
    current: component.properties.showCurrent === true ? rule(formatQuantity(result?.branchCurrents[component.id], 'A', resultOptions), 'current') : null,
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
  return def.property ? storedFraction(component.properties,def.property,def.unit) ?? quantityInput(component.properties[def.property] as q.Scalar) : '';
}

export function notationWidth(text:string,fontSize:number):number {
  return notationTokens(text).reduce((sum,token)=>sum+(token.kind==='subscript'?notationWidth(token.text,fontSize*.7)/fontSize:token.kind==='fraction'?Math.max(token.numerator.length,token.denominator.length)*.64+.4:[...token.text].reduce((n,c)=>n+(c===' '?.3:c.codePointAt(0)!>255?1.05:/[MW@]/.test(c)?.9:.58),0))*fontSize,0);
}
export function svgNotation(text:string,options:{x:number;y:number;fontSize:number;anchor?:'start'|'middle';fill?:string;weight?:string;symbol?:boolean}):string {
  const {x,y,fontSize,anchor='start',fill='currentColor',weight='400'}=options;
  const clean=(value:string)=>escapeXml(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'�'));
  const tokens=notationTokens(text);
  const display=notationDisplayText(text,options.symbol);
  const displayed=notationTokens(display);
  const written=clean;
  if(tokens.every(t=>t.kind==='text'))return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${written(display)}</text>`;
  let cursor=x-(anchor==='middle'?notationWidth(text,fontSize)/2:0);
  const parts:string[]=[];
  for(const [index,token] of tokens.entries()){
    const shown=displayed[index];
    const shownText=shown.kind!=='fraction'?shown.text:'';
    if(token.kind==='text'){
      parts.push(`<text x="${cursor}" y="${y}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" xml:space="preserve">${written(shownText)}</text>`);
      cursor+=notationWidth(token.text,fontSize);
    }else if(token.kind==='subscript'){
      parts.push(`<text data-notation="subscript" x="${cursor}" y="${y+.28*fontSize}" font-size="${fontSize*.7}" font-weight="${weight}" fill="${fill}">${written(shownText)}</text>`);
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
  const written=escapeXml;
  return notationTokens(notationDisplayText(text,symbol)).map(t=>t.kind==='text'?written(t.text):t.kind==='subscript'?`<sub>${written(t.text)}</sub>`:`<span class="notation-fraction" aria-hidden="true"><span>${escapeXml(t.numerator)}</span><span>${escapeXml(t.denominator)}</span></span>`).join('');
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

/** Keep long value labels inside their horizontal component slot while zoomed out. */
export function componentValueFontSize(components:readonly ComponentInstance[],component:ComponentInstance,value:string,fontSize:number):number {
  if(component.rotation%180!==0)return fontSize;
  const neighbours=components.filter(c=>c.id!==component.id&&c.rotation%180===0&&Math.abs(c.position.y-component.position.y)<fontSize*2&&c.position.x!==component.position.x);
  const slot=neighbours.reduce((width,c)=>Math.min(width,Math.abs(c.position.x-component.position.x)),Infinity);
  return Math.min(fontSize,Math.max(1,slot-12)/Math.max(1,notationWidth(value,1)));
}

/** A reading belongs to a component only for its ID or its two distinct terminals. */
export function quantityFormatForTargets(document:CircuitDocument,ids:readonly string[]):QuantityFormatOptions {
  const component=ids.length===1?document.components.find(c=>c.id===ids[0]):ids.length===2&&ids[0]!==ids[1]?document.components.find(c=>ids.every(id=>c.terminals.some(t=>t.id===id))):undefined;
  return quantityFormatFor(component?.properties);
}
