import { useEffect, useRef, useState } from 'react';
import type { CircuitDocument, ComponentType, EndpointRef, Point, SimulationResult } from '../domain';
import { componentPresentation, annotationPlacements, type WorksheetMode, type NumberFormat, componentValue, documentBounds, endpointPosition, pointsAttribute, symbolMarkup, terminalPosition, wirePoints } from '../component-library';

export interface CanvasProps {
  readOnly?: boolean;
  document: CircuitDocument; selected: string[]; tool: string; placement: ComponentType | null;
  wireStart: EndpointRef | null; onSelect: (id: string | null, additive?: boolean) => void;
  onMove: (positions: Record<string, Point>) => void; onPlace: (type: ComponentType, point: Point) => void;
  onEndpoint: (endpoint: EndpointRef) => void; onWire: (id: string, point: Point) => void;
  onValue: (id: string) => void; onSwitch: (id: string) => void;
  onBackground: (point: Point) => void;
  endpointColors?: Record<string, string>; endpointLabels?: Record<string, string>; endpointGroups?: Record<string, string>;
  highlightedEndpoints?: string[]; highlightedElements?: string[]; onHoverElement?: (id: string | null) => void;
  problemMode?: boolean; worksheetMode?: WorksheetMode; numberFormat?: NumberFormat; simulationResult?: SimulationResult;
  currentArrows?: Record<string, number>;
  probes?: { red: string; black: string }; largeLabels?: boolean;
}
export function CircuitCanvas(props: CanvasProps) {
  const { document, selected, tool, placement, wireStart } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState(() => documentBounds(document, 110));
  useEffect(() => { setView(documentBounds(document, 110)); }, [document.documentId]);
  const [pointer, setPointer] = useState<Point>({ x: 500, y: 300 });
  const [drag, setDrag] = useState<{ start: Point; positions: Record<string, Point>; pointerId: number } | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number; view: typeof view } | null>(null);
  const [preview, setPreview] = useState<Record<string, Point>>({});
  const [viewport, setViewport] = useState({ width: 1000, height: 620 });
  useEffect(() => { if (!svg.current) return; const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(svg.current); return () => observer.disconnect(); }, []);
  const drawingScale = Math.max(.01, Math.min(viewport.width / view.width, viewport.height / view.height));
  const labelScale = Math.max(props.largeLabels ? 1.5 : 1, .85 / drawingScale);
  const snap = (p: Point) => ({ x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 });
  function point(clientX: number, clientY: number): Point {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()); return { x: p.x, y: p.y };
  }
  const effective = { ...document, components: document.components.map(c => preview[c.id] ? { ...c, position: preview[c.id] } : c), wires: document.wires.map(w => Object.keys(preview).length ? { ...w, waypoints: [] } : w) };
  // One callout per electrical net. Reserve component label areas before placing callouts.
  const occupied = effective.components.map(c => ({ x: c.position.x - 68 * labelScale, y: c.position.y - 55 * labelScale, w: 136 * labelScale, h: 110 * labelScale }));
  const seenNets = new Set<string>();
  const callouts = [...effective.junctions.map(j => ({ id: j.id, point: j.position })), ...effective.components.flatMap(c => c.terminals.map((t, i) => ({ id: t.id, point: terminalPosition(c, i) })))].flatMap(({ id, point: anchor }) => {
    const text = props.endpointLabels?.[id]; const group = props.endpointGroups?.[id] ?? id;
    if (!text || seenNets.has(group)) return [];
    seenNets.add(group);
    const w = Math.max(50, text.length * 7.5 + 12) * labelScale, h = 22 * labelScale;
    const clampBox = (x: number, y: number) => ({ x: Math.max(view.x + 12 * labelScale, Math.min(view.x + view.width - w - 12 * labelScale, x)), y: Math.max(view.y + 12 * labelScale, Math.min(view.y + view.height - h - 35 * labelScale, y)), w, h });
    let box = clampBox(anchor.x - w / 2, anchor.y - 90 * labelScale);
    outer: for (let ring = 0; ring < 20; ring++) for (const dy of [-1, 1]) for (const dx of [0, -1, 1]) {
      const candidate = clampBox(anchor.x - w / 2 + dx * (w + 12 * labelScale), anchor.y + dy * (70 + ring * 28) * labelScale);
      if (!occupied.some(b => candidate.x < b.x+b.w+6 && candidate.x+w+6 > b.x && candidate.y < b.y+b.h+6 && candidate.y+h+6 > b.y)) { box = candidate; break outer; }
    }
    occupied.push(box); return [{ id, text, anchor, ...box }];
  });
  const annotationLabels = annotationPlacements(effective, props.worksheetMode ?? 'answer').map(item => {
    const anchor = endpointPosition(effective, item.annotation.anchor);
    const w = Math.max(42, item.text.length * 13 + (item.annotation.kind === 'arrow' ? 58 : 10)) * labelScale, h = 25 * labelScale;
    const clamp = (x: number, y: number) => ({x:Math.max(view.x+12*labelScale,Math.min(view.x+view.width-w-12*labelScale,x)),y:Math.max(view.y+12*labelScale,Math.min(view.y+view.height-h-35*labelScale,y)),w,h});
    let box = clamp(item.x, item.y-h);
    outer: for(let ring=0;ring<20;ring++) for(const dy of [-1,1]) for(const dx of [0,-1,1,-2,2]) {
      const candidate=clamp(anchor.x+dx*(w+12*labelScale),anchor.y+dy*(75+ring*28)*labelScale);
      if(!occupied.some(b=>candidate.x<b.x+b.w+6&&candidate.x+w+6>b.x&&candidate.y<b.y+b.h+6&&candidate.y+h+6>b.y)){box=candidate;break outer;}
    }
    occupied.push(box);return {...item,anchor,x:box.x,y:box.y+18*labelScale,width:w};
  });
  const endColor = (id: string) => props.endpointColors?.[id] ?? '#263548';
  const highlighted = (id: string) => props.highlightedEndpoints?.includes(id);
  const zoom = (factor: number) => setView(v => { const width = Math.min(5000, Math.max(200, v.width * factor)); const height = width * v.height / v.width; return { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height }; });
  function chooseEndpoint(ref: EndpointRef) { props.onEndpoint(ref); }
  return <div className={`canvas-shell ${placement ? 'placing' : ''}`}>
    <svg ref={svg} className="circuit-canvas" aria-label={props.readOnly ? '측정 회로' : '회로 편집 캔버스'} role="group" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} tabIndex={0}
      onWheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : 0.9); } }}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if(props.readOnly) return; const type = e.dataTransfer.getData('component') as ComponentType; if (['dc-voltage-source', 'resistor', 'switch', 'ammeter', 'voltmeter', 'resistive-load'].includes(type)) props.onPlace(type, snap(point(e.clientX, e.clientY))); }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (!props.readOnly && placement && e.key === 'Enter') { e.preventDefault(); props.onPlace(placement, snap({ x: view.x + view.width / 2, y: view.y + view.height / 2 })); }
        if (e.key === '+' || e.key === '=') zoom(.8);
        if (e.key === '-') zoom(1.25);
        if (tool === 'pan' && e.key.startsWith('Arrow')) { e.preventDefault(); e.stopPropagation(); setView(v => ({ ...v, x: v.x + (e.key === 'ArrowRight' ? 40 : e.key === 'ArrowLeft' ? -40 : 0), y: v.y + (e.key === 'ArrowDown' ? 40 : e.key === 'ArrowUp' ? -40 : 0) })); }
      }}
      onPointerDown={e => {
        if (e.button === 1 || tool === 'pan') { e.preventDefault(); setPan({ x: e.clientX, y: e.clientY, view }); e.currentTarget.setPointerCapture(e.pointerId); return; }
        if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('canvas-background')) return;
        const p = snap(point(e.clientX, e.clientY));
        if (placement) props.onPlace(placement, p); else { props.onSelect(null); props.onBackground(p); }
      }}
      onPointerMove={e => {
        const p = point(e.clientX, e.clientY); setPointer(p);
        if (pan && svg.current) { const scale = pan.view.width / svg.current.clientWidth; setView({ ...pan.view, x: pan.view.x - (e.clientX - pan.x) * scale, y: pan.view.y - (e.clientY - pan.y) * scale }); }
        if (drag) { const delta = snap({ x: p.x - drag.start.x, y: p.y - drag.start.y }); setPreview(Object.fromEntries(Object.entries(drag.positions).map(([id, pos]) => [id, { x: pos.x + delta.x, y: pos.y + delta.y }]))); }
      }}
      onPointerUp={e => {
        if (drag && Object.keys(preview).length && Object.entries(preview).some(([id, p]) => p.x !== drag.positions[id].x || p.y !== drag.positions[id].y)) props.onMove(preview);
        setDrag(null); setPreview({}); setPan(null); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }} onPointerCancel={() => { setDrag(null); setPreview({}); setPan(null); }}>
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1" fill="#d5dce3" /></pattern></defs>
      <rect className="canvas-background" x={view.x} y={view.y} width={view.width} height={view.height} fill="url(#grid)" />
      {!document.components.length && <g pointerEvents="none"><text x="500" y="270" textAnchor="middle" fontSize="24" fill="#5c6978">첫 번째 회로를 그려볼까요?</text><text x="500" y="306" textAnchor="middle" fontSize="15" fill="#8290a0">왼쪽에서 부품을 선택하고 이곳에 놓으세요.</text></g>}
      {effective.wires.map(w => <g key={w.id}>
        <polyline points={pointsAttribute(wirePoints(effective, w))} fill="none" stroke={highlighted(w.start.id) ? '#f5a623' : selected.includes(w.id) ? '#3478f6' : endColor(w.start.id)} strokeWidth={highlighted(w.start.id) ? 5 : 2.5} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={pointsAttribute(wirePoints(effective, w))} fill="none" stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={`도선 ${w.id}`} onClick={e => { e.stopPropagation(); props.onWire(w.id, snap(point(e.clientX, e.clientY))); }} onKeyDown={e => { if (e.key === 'Enter') { const [a, b] = wirePoints(effective, w); props.onWire(w.id, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); } }} />
      </g>)}
      {effective.components.map(c => {
        const select = selected.includes(c.id); const glow = props.highlightedElements?.includes(c.id);
        const presentation = props.worksheetMode ? componentPresentation(c, props.worksheetMode, props.simulationResult, props.numberFormat) : { label: c.label, value: componentValue(c), voltage: null, current: null };
        const value = presentation.value;
        return <g key={c.id} onMouseEnter={() => props.onHoverElement?.(c.id)} onMouseLeave={() => props.onHoverElement?.(null)}>
          {(select || glow) && <rect x={c.position.x - 62} y={c.position.y - 58} width="124" height="116" rx="12" fill={glow ? '#fff4d6' : '#eaf1ff'} stroke={glow ? '#efb14c' : '#3478f6'} strokeWidth="1.5" strokeDasharray={select ? '5 4' : undefined} />}
          <g role="button" tabIndex={0} aria-label={`${c.label} ${componentValue(c)}`} className="component" onPointerDown={e => {
            if (props.readOnly) { e.stopPropagation(); props.onSelect(c.id); return; }
            if (tool === 'path') { e.stopPropagation(); props.onSelect(c.id); return; }
            if (tool !== 'select' || placement) return; e.stopPropagation();
            const ids = selected.includes(c.id) ? selected : [c.id];
            if (!selected.includes(c.id) || e.shiftKey) props.onSelect(c.id, e.shiftKey);
            if (e.shiftKey) return;
            setDrag({ start: point(e.clientX, e.clientY), positions: Object.fromEntries(document.components.filter(x => ids.includes(x.id)).map(x => [x.id, x.position])), pointerId: e.pointerId });
            svg.current?.setPointerCapture(e.pointerId);
          }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSelect(c.id, e.shiftKey); } }} onDoubleClick={() => { if(!props.readOnly) { if(c.type === 'switch') props.onSwitch(c.id); else props.onValue(c.id); } }}>
            <rect x={c.position.x - 36} y={c.position.y - 30} width="72" height="60" fill="transparent" />
            <g transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`} stroke="#263548" fill="white" strokeWidth="2.5" color="#263548" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: symbolMarkup(c) }} />
          </g>
          {props.currentArrows?.[c.id] !== undefined && props.currentArrows[c.id] !== 0 && <g transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`} stroke="#70828f" strokeWidth={Math.min(4, 1 + Math.sqrt(Math.abs(props.currentArrows[c.id])))} fill="none" pointerEvents="none"><path d={props.currentArrows[c.id] > 0 ? 'M-20 24H20 M13 19L20 24 13 29' : 'M20 24H-20 M-13 19L-20 24 -13 29'}/></g>}
          <text x={c.position.x + (c.rotation % 180 ? 32 * labelScale : 0)} y={c.position.y + (c.rotation % 180 ? -9 * labelScale : -30 * labelScale)} textAnchor={c.rotation % 180 ? 'start' : 'middle'} fontSize={14 * labelScale} fontWeight="650" fill="#344358" pointerEvents="none">{presentation.label}</text>
          <text className={props.readOnly ? 'component-value' : 'editable-value'} role={props.readOnly ? undefined : 'button'} tabIndex={props.readOnly ? undefined : 0} aria-label={props.readOnly ? undefined : `${c.label} 값 편집`} x={c.position.x + (c.rotation % 180 ? 32 * labelScale : 0)} y={c.position.y + (c.rotation % 180 ? 13 * labelScale : 38 * labelScale)} textAnchor={c.rotation % 180 ? 'start' : 'middle'} fontSize={14 * labelScale} fill="#64758b" onClick={() => { if(!props.readOnly) props.onValue(c.id); }} onKeyDown={e => { if (!props.readOnly && e.key === 'Enter') props.onValue(c.id); }}>{value}</text>
          {[presentation.voltage && `U = ${presentation.voltage}`, presentation.current && `I = ${presentation.current}`].filter(Boolean).map((text,i)=><text key={i} x={c.position.x+(c.rotation%180?32*labelScale:0)} y={c.position.y+(c.rotation%180?38+i*22:61+i*22)*labelScale} textAnchor={c.rotation%180?'start':'middle'} fontSize={12*labelScale} fill="#506a88" pointerEvents="none">{text}</text>)}
          {c.terminals.map((t, i) => { const p = terminalPosition(c, i); return <g key={t.id} role="button" tabIndex={0} aria-label={`단자 ${t.id}`} className="terminal" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); chooseEndpoint({ kind: 'terminal', id: t.id }); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseEndpoint({ kind: 'terminal', id: t.id }); } }}>
            <circle cx={p.x} cy={p.y} r="1" fill="transparent" stroke="transparent" strokeWidth="40" vectorEffect="non-scaling-stroke" /><circle cx={p.x} cy={p.y} r={highlighted(t.id) || wireStart?.id === t.id ? 6 : 4} fill={wireStart?.id === t.id ? '#3478f6' : endColor(t.id)} stroke="white" strokeWidth="1.2" />
            <title>{props.endpointLabels?.[t.id]}</title>
          </g>; })}
        </g>;
      })}
      {document.junctions.map(j => <g key={j.id} role="button" tabIndex={0} aria-label={`분기점 ${j.id}`} className="terminal" onClick={e => { e.stopPropagation(); chooseEndpoint({ kind: 'junction', id: j.id }); }} onKeyDown={e => { if (e.key === 'Enter') chooseEndpoint({ kind: 'junction', id: j.id }); }}>
        <circle cx={j.position.x} cy={j.position.y} r="1" fill="transparent" stroke="transparent" strokeWidth="40" vectorEffect="non-scaling-stroke"/><circle cx={j.position.x} cy={j.position.y} r="5" fill={highlighted(j.id) ? '#f5a623' : endColor(j.id)} />
        <title>{props.endpointLabels?.[j.id]}</title>
      </g>)}
      {document.referenceNode && (() => { const p = endpointPosition(effective, document.referenceNode!); return <g transform={`translate(${p.x},${p.y + 9})`} pointerEvents="none" stroke="#8694a5" strokeWidth="1.5"><path d="M0 0V10 M-10 10H10 M-6 14H6 M-2 18H2"/><text x={16 * labelScale} y={16 * labelScale} fill="#6a7c92" stroke="none" fontSize={11 * labelScale}>0 V</text></g>; })()}
      {annotationLabels.map(({annotation:a,text,x,y,width,anchor})=><g key={a.id} role="button" tabIndex={0} aria-label={`주석 ${text || a.kind}`} onClick={e=>{e.stopPropagation();props.onSelect(a.id);}} onKeyDown={e=>{if(e.key==='Enter')props.onSelect(a.id);}}>
        <path d={`M${anchor.x} ${anchor.y}L${x+width/2} ${y}`} fill="none" stroke="#adb8c5" strokeWidth="1" strokeDasharray="3 3" pointerEvents="none"/>
        {selected.includes(a.id)&&<rect x={x-5} y={y-20*labelScale} width={width+10} height={30*labelScale} rx="4" fill="#eaf1ff" stroke="#3478f6" strokeDasharray="4 3"/>}
        {a.kind==='arrow'&&<path d={`M${x} ${y-5*labelScale}h${40*labelScale} m${-7*labelScale} ${-5*labelScale} ${7*labelScale} ${5*labelScale} ${-7*labelScale} ${5*labelScale}`} fill="none" stroke="#263548" strokeWidth="2"/>}
        <text x={x+(a.kind==='arrow'?48*labelScale:0)} y={y} fontSize={14*labelScale} fill="#263548" paintOrder="stroke" stroke="white" strokeWidth="4">{text}</text>
      </g>)}
      {callouts.map(label => <g key={label.id} pointerEvents="none"><path d={`M${label.anchor.x} ${label.anchor.y}L${label.x+label.w/2} ${label.y+label.h}`} fill="none" stroke={endColor(label.id)} strokeWidth="1" strokeDasharray="3 3"/><rect x={label.x} y={label.y} width={label.w} height={label.h} rx={5*labelScale} fill="white" stroke={endColor(label.id)}/><text x={label.x+label.w/2} y={label.y+15*labelScale} textAnchor="middle" fontSize={12*labelScale} fill={endColor(label.id)}>{label.text}</text></g>)}
      {props.probes && (['red','black'] as const).map(color => { const id=props.probes![color]; const kind=document.junctions.some(j=>j.id===id)?'junction':'terminal'; if(!document.junctions.some(j=>j.id===id)&&!document.components.some(c=>c.terminals.some(t=>t.id===id)))return null; const p=endpointPosition(effective,{kind,id}), ink=color==='red'?'#d83e44':'#263548';return <g key={color} pointerEvents="none" stroke={ink} fill="white"><circle cx={p.x} cy={p.y} r={(color==='red'?9:13)*labelScale} fill="none" strokeWidth="2"/><text x={p.x+(color==='red'?-18:18)*labelScale} y={p.y+28*labelScale} textAnchor="middle" stroke="white" paintOrder="stroke" strokeWidth="3" fill={ink} fontSize={14*labelScale}>{color==='red'?'+':'−'}</text></g>; })}
      {wireStart && <polyline points={pointsAttribute([endpointPosition(effective, wireStart), { x: endpointPosition(effective, wireStart).x, y: snap(pointer).y }, snap(pointer)])} fill="none" stroke="#3478f6" strokeWidth="2" strokeDasharray="7 5" pointerEvents="none" />}
      {placement && <g transform={`translate(${snap(pointer).x},${snap(pointer).y})`} opacity=".45" pointerEvents="none"><rect x="-50" y="-35" width="100" height="70" rx="8" fill="#dbe8ff" stroke="#3478f6"/><circle cx="-44" r="4" fill="#3478f6"/><circle cx="44" r="4" fill="#3478f6"/><text textAnchor="middle" y="5" fill="#235dbd" fontSize="13">여기에 배치</text></g>}
    </svg>
    <div className="canvas-view-tools"><button onClick={() => zoom(.8)} aria-label="확대">＋</button><span>{Math.round(100000 / view.width)}%</span><button onClick={() => zoom(1.25)} aria-label="축소">−</button><button onClick={() => setView(documentBounds(document, 110))}>전체 보기</button></div>
    <div className="canvas-caption"><span className="small-dot" />{props.readOnly ? '측정 회로' : '이상적인 선형 직류 회로 · 20 단위 격자'}</div>
  </div>;
}

