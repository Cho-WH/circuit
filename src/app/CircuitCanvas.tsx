import { parseQuantity } from '../notation';
import { Notation, SvgNotation } from './Notation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CircuitDocument, ComponentType, EndpointRef, Point } from '../domain';
import { insertionCandidates, previewCommand, type Command } from '../editor';
import { useContextWiring, WiringMarks, WiringOverlay, endpointTarget, wiringTargets } from './wiring';
import { useTouchNavigation } from './useTouchNavigation';
import { componentDefinitions, circuitTextScale, componentNotationLayout, notationMetrics, createComponent, wireCrossings, wirePath, componentValue, componentValueInput, documentBounds, endpointPosition, pointsAttribute, symbolMarkup, terminalPosition, wirePoints } from '../component-library';

export interface CanvasProps {
  readOnly?: boolean;
  readOnlyLabel?: string;
  onWiringCommit?: (commands: readonly Command[]) => boolean;
  wiringResetKey?: number;
  document: CircuitDocument; selected: string[]; tool: string; placement: ComponentType | null;
  onSelect: (id: string | null, additive?: boolean) => void;
  onMove: (positions: Record<string, Point>) => void; onPlace: (type: ComponentType, point: Point, target?: {wireId:string;segment:number}) => void;
  onCommitComponent?: (id:string, edit:{label:string;value?:number;fraction?:string}) => boolean;
  onCancel?: () => void;
  onAction?: (action:'rotate'|'copy'|'delete') => void;
  focusIds?: string[];
  onEndpoint: (endpoint: EndpointRef) => void; onWire: (id: string, point: Point) => void;
  onValue: (id: string) => void; onSwitch: (id: string) => void;
  onBackground: (point: Point) => void;
  endpointColors?: Record<string, string>; endpointLabels?: Record<string, string>; endpointGroups?: Record<string, string>;
  highlightedEndpoints?: string[]; highlightedElements?: string[]; onHoverElement?: (id: string | null) => void;
  currentArrows?: Record<string, number>;
  probes?: { red: string; black: string }; largeLabels?: boolean;
}
export function CircuitCanvas(props: CanvasProps) {
  const { document, selected, tool, placement } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState(() => documentBounds(document, 110));
  useEffect(() => { setView(documentBounds(document, 110)); }, [document.documentId]);
  const [pointer, setPointer] = useState<Point>({ x: 500, y: 300 });
  const [insertionWire,setInsertionWire]=useState<string>();
  const [choosingInsertion,setChoosingInsertion]=useState(false);
  const [placementMessage,setPlacementMessage]=useState('');
  const [editing,setEditing]=useState<{id:string;label:string;draft:string;error:string}|null>(null);
  const inlineInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(editing){inlineInput.current?.focus({preventScroll:true});inlineInput.current?.select();}},[editing?.id]);
  useEffect(()=>{setEditing(null);setInsertionWire(undefined);setChoosingInsertion(false);setPlacementMessage('');},[document,tool,placement,props.readOnly]);
  const [drag, setDrag] = useState<{ start: Point; current: Point; positions: Record<string, Point>; pointerId: number; document: CircuitDocument } | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number; view: typeof view } | null>(null);
  const capturedPointer = useRef<number | null>(null);
  function cancelGesture() {
    setDrag(null); setPan(null);
    const id = capturedPointer.current;
    capturedPointer.current = null;
    if (id !== null && svg.current?.hasPointerCapture(id)) svg.current.releasePointerCapture(id);
  }
  useEffect(() => { cancelGesture(); }, [document, tool, placement, props.readOnly]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelGesture(); };
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', cancelGesture);
    return () => { window.removeEventListener('keydown', cancel); window.removeEventListener('blur', cancelGesture); };
  }, []);
  const [viewport, setViewport] = useState({ width: 1000, height: 620 });
  useEffect(() => { if (!svg.current) return; const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(svg.current); return () => observer.disconnect(); }, []);
  const drawingScale = Math.max(.01, Math.min(viewport.width / view.width, viewport.height / view.height));
  const wiring = useContextWiring({ document, enabled: Boolean(props.onWiringCommit) && !props.readOnly && !placement && (tool === 'select' || tool === 'wire'), tool, selected, resetKey: props.wiringResetKey, onSelect: props.onSelect, commit: props.onWiringCommit, onFinish: props.onCancel });
  const touchNavigation = useTouchNavigation(view, setView, drawingScale, cancelGesture);
  useEffect(() => { touchNavigation.reset(); }, [document, tool, placement, props.readOnly]);
  const inputType = useRef('mouse');
  const cancelWiring = () => { wiring.cancel(); props.onCancel?.(); };
  useEffect(()=>{
    if(!props.focusIds?.length)return;
    const points=[...document.components.filter(c=>props.focusIds!.includes(c.id)).map(c=>c.position),...document.junctions.filter(j=>props.focusIds!.includes(j.id)).map(j=>j.position),...document.wires.filter(w=>props.focusIds!.includes(w.id)).flatMap(w=>wirePoints(document,w))];
    if(points.length)setView(v=>({...v,x:points.reduce((sum,p)=>sum+p.x,0)/points.length-v.width/2,y:points.reduce((sum,p)=>sum+p.y,0)/points.length-v.height/2}));
  },[props.focusIds]);
  const labelScale = Math.max(props.largeLabels ? 2.25 : circuitTextScale, .85*circuitTextScale / drawingScale);
  const snap = (p: Point) => ({ x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 });
  useEffect(()=>{if(placement)setPointer(snap({x:view.x+view.width/2,y:view.y+view.height/2}));},[placement]);
  function point(clientX: number, clientY: number): Point {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()); return { x: p.x, y: p.y };
  }
  const activeDrag = drag?.document === document && tool === 'select' && !placement && !props.readOnly ? drag : null;
  function dragPositions(session: NonNullable<typeof drag>, current: Point): Record<string, Point> {
    const delta = snap({ x: current.x - session.start.x, y: current.y - session.start.y });
    if (delta.x === 0 && delta.y === 0) return {};
    return Object.fromEntries(Object.entries(session.positions).map(([id, pos]) => [id, { x: pos.x + delta.x, y: pos.y + delta.y }]));
  }
  const movedDocument = useMemo(() => {
    if (!activeDrag) return document;
    const positions = dragPositions(activeDrag, activeDrag.current);
    if (!Object.keys(positions).length) return document;
    const result = previewCommand(document, { type: 'MoveComponents', positions });
    return result.ok ? result.document : document;
  }, [document, activeDrag]);
  const candidates=placement?insertionCandidates(document,snap(pointer)):[];
  const chosenCandidates=insertionWire?candidates.filter(c=>c.wireId===insertionWire):candidates;
  const candidate=chosenCandidates.length===1?chosenCandidates[0]:undefined;
  let previewId='__placement';
  const usedIds=new Set([...document.components,...document.components.flatMap(c=>c.terminals),...document.wires,...document.junctions,...document.annotations].map(x=>x.id));
  while([previewId,previewId+'.a',previewId+'.b',previewId+'.wire'].some(id=>usedIds.has(id)))previewId+='_';
  const previewComponent=placement?createComponent(placement,previewId,candidate?.position??snap(pointer)):null;
  if(previewComponent&&candidate)previewComponent.rotation=candidate.rotation;
  const insertionPreview=previewComponent&&candidate&&!candidate.reason&&placement!=='voltmeter'?previewCommand(document,{type:'InsertComponentOnWire',component:previewComponent,wireId:candidate.wireId,segment:candidate.segment,newWireId:previewId+'.wire'}):null;
  const effective=insertionPreview?.ok?insertionPreview.document:movedDocument;
  const crossings=wireCrossings(effective);
  function placeAt(type:ComponentType,p:Point){
    const all=insertionCandidates(document,p);
    const options=insertionWire?all.filter(c=>c.wireId===insertionWire):all;
    if(all.length){
      if(options.length!==1){setPointer(p);setChoosingInsertion(true);setPlacementMessage('겹친 도선 중 삽입할 도선을 선택하세요.');return;}
      const target=options[0];
      if(type==='voltmeter'||target.reason){setPlacementMessage(type==='voltmeter'?'전압계는 빈 공간에 놓고 두 점에 병렬로 연결하세요.':target.reason==='space'?'부품 양쪽에 공간이 필요합니다. 꺾임·단자에서 더 떨어진 곳을 선택하세요.':'교차점에서 떨어진 구간에 놓으세요.');return;}
      props.onPlace(type,p,{wireId:target.wireId,segment:target.segment});
    }else props.onPlace(type,p);
  }
  function editValue(id:string,fromAction=false){
    const c=document.components.find(c=>c.id===id),def=c&&componentDefinitions[c.type];
    if(!c||!def)return;
    if(c.type==='switch'&&!fromAction){props.onSwitch(id);return;}
    props.onSelect(id);
    if(props.onCommitComponent)setEditing({id,label:c.label,draft:componentValueInput(c),error:''});else props.onValue(id);
  }
  function closeEditor(){const id=editing?.id;setEditing(null);window.setTimeout(()=>{const target=[...(svg.current?.querySelectorAll<SVGElement>('.editable-value')??[])].find(el=>el.getAttribute('data-value-id')===id);target?.focus();},0);}
  const editingComponent=document.components.find(c=>c.id===editing?.id);
  const editingDefinition=editingComponent&&componentDefinitions[editingComponent.type];
  const screenPoint=(p:Point)=>({x:(viewport.width-view.width*drawingScale)/2+(p.x-view.x)*drawingScale,y:(viewport.height-view.height*drawingScale)/2+(p.y-view.y)*drawingScale});
  const editorPoint=editingComponent?screenPoint(editingComponent.position):{x:0,y:0};
  const selectedComponent=document.components.find(c=>c.id===selected[0]);
  const selectionPoint=selectedComponent?screenPoint(selectedComponent.position):{x:0,y:0};
  const editorHeight=editing?.error?240:186;
  const editLayout=editingComponent?componentNotationLayout(editingComponent,editingComponent.label,componentValue(editingComponent),14*labelScale):null;
  const editorGap=Math.max(72,((editLayout?.value.y??0)-(editingComponent?.position.y??0)+notationMetrics(editingComponent?componentValue(editingComponent):'',14*labelScale).descent+18)*drawingScale);
  const editorTop=editorPoint.y+editorGap+editorHeight<viewport.height?editorPoint.y+editorGap:Math.max(8,editorPoint.y-editorGap-editorHeight);
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
  const endColor = (id: string) => props.endpointColors?.[id] ?? '#263548';
  const highlighted = (id: string) => props.highlightedEndpoints?.includes(id);
  const zoom = (factor: number) => setView(v => { const width = Math.min(5000, Math.max(200, v.width * factor)); const height = width * v.height / v.width; return { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height }; });
  function chooseEndpoint(ref: EndpointRef) { if (wiring.active) wiring.activate(endpointTarget(document, ref), inputType.current === 'touch'); else props.onEndpoint(ref); }
  const wireOrigin = wiring.active ? wiring.start?.point : null;
  const isWireStart = (id: string) => wiring.start?.kind === 'endpoint' && wiring.start.ref.id === id;
  const wireEnd = wiring.active && wiring.end ? wiring.end : snap(pointer);
  return <div className={`canvas-shell ${placement ? 'placing' : ''} ${wiring.active ? 'smart-wiring' : ''}`}>
    <svg ref={svg} className="circuit-canvas" aria-label={props.readOnly ? (props.readOnlyLabel??'측정 회로') : '회로 편집 캔버스'} role="group" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} tabIndex={0}
      onPointerDownCapture={e => {
        inputType.current = e.pointerType; wiring.setTouch(e.pointerType === 'touch');
        const target = e.target as Element;
        if (target.closest('[data-wiring-ui]')) return;
        const componentId = target.closest('[data-component-id]')?.getAttribute('data-component-id');
        const hits = wiring.active ? wiringTargets(document, point(e.clientX, e.clientY), drawingScale, Boolean(wiring.start)) : [];
        const selectedBody = target.closest('.editable-value') || (componentId && selected.includes(componentId) && !hits.length);
        if (touchNavigation.down(e, !selectedBody)) { e.stopPropagation(); return; }
        if (wiring.active && hits.length && !target.closest('.editable-value')) e.stopPropagation();
      }}
      onPointerMoveCapture={e => {
        if (touchNavigation.move(e)) { wiring.clearHint(); e.stopPropagation(); return; }
        if (e.pointerType !== 'touch' && !activeDrag && !pan) { wiring.setTouch(false); wiring.hover(point(e.clientX, e.clientY), drawingScale); }
      }}
      onPointerUpCapture={e => { if (touchNavigation.up(e)) e.stopPropagation(); }}
      onPointerCancelCapture={e => { touchNavigation.up(e, true); }}
      onClickCapture={e => {
        if (touchNavigation.consumeClick()) { e.stopPropagation(); e.preventDefault(); return; }
        const target = (inputType.current === 'touch' ? svg.current?.ownerDocument.elementFromPoint?.(e.clientX, e.clientY) ?? e.target : e.target) as Element | null;
        if (target?.closest('[data-wiring-ui]')) return;
        if (target?.closest('.editable-value')) return;
        if (wiring.active && wiring.tap(point(e.clientX, e.clientY), drawingScale, inputType.current === 'touch')) { e.stopPropagation(); return; }
        if (inputType.current === 'touch') {
          if (tool === 'pan') { e.stopPropagation(); return; }
          const endpointElement = target?.closest('[data-endpoint-id]');
          if (!wiring.active && endpointElement) { e.stopPropagation(); chooseEndpoint({kind:endpointElement.getAttribute('data-endpoint-kind') as EndpointRef['kind'],id:endpointElement.getAttribute('data-endpoint-id')!}); return; }
          const wireElement = target?.closest('[data-wire-id]');
          if (!wiring.active && wireElement) { e.stopPropagation(); props.onWire(wireElement.getAttribute('data-wire-id')!,snap(point(e.clientX,e.clientY))); return; }
          const id = target?.closest('[data-component-id]')?.getAttribute('data-component-id');
          if (id) { wiring.cancel(); props.onSelect(id); }
          else if (placement && !props.readOnly) placeAt(placement, snap(point(e.clientX, e.clientY)));
          else { wiring.clearHint(); props.onSelect(null); }
        }
      }}
      onWheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : 0.9); } }}
      onDragOver={e => {e.preventDefault();setPointer(point(e.clientX,e.clientY));}} onDrop={e => { e.preventDefault(); if(props.readOnly) return; const type = e.dataTransfer.getData('component') as ComponentType; if (['dc-voltage-source', 'resistor', 'switch', 'ammeter', 'voltmeter', 'resistive-load'].includes(type)) placeAt(type, snap(point(e.clientX, e.clientY))); }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (!props.readOnly && placement && e.key === 'Enter') { e.preventDefault(); placeAt(placement, snap(pointer)); }
        if (!props.readOnly && placement && e.key.startsWith('Arrow')) { e.preventDefault(); e.stopPropagation();setPointer(p=>snap({x:p.x+(e.key==='ArrowRight'?20:e.key==='ArrowLeft'?-20:0),y:p.y+(e.key==='ArrowDown'?20:e.key==='ArrowUp'?-20:0)})); }
        if (e.key === '+' || e.key === '=') zoom(.8);
        if (e.key === '-') zoom(1.25);
        if (tool === 'pan' && e.key.startsWith('Arrow')) { e.preventDefault(); e.stopPropagation(); setView(v => ({ ...v, x: v.x + (e.key === 'ArrowRight' ? 40 : e.key === 'ArrowLeft' ? -40 : 0), y: v.y + (e.key === 'ArrowDown' ? 40 : e.key === 'ArrowUp' ? -40 : 0) })); }
      }}
      onPointerDown={e => {
        if (capturedPointer.current !== null) return;
        if (e.button === 1 || tool === 'pan') { e.preventDefault(); setPan({ x: e.clientX, y: e.clientY, view }); capturedPointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); return; }
        if (e.button !== 0) return;
        if(placement&&!props.readOnly){e.preventDefault();placeAt(placement,snap(point(e.clientX,e.clientY)));return;}
        if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('canvas-background')) return;
        const p = snap(point(e.clientX, e.clientY));
        wiring.clearHint(); props.onSelect(null); props.onBackground(p);
      }}
      onPointerMove={e => {
        const p = point(e.clientX, e.clientY); if(!choosingInsertion){setPointer(p);setPlacementMessage('');}
        if (pan && capturedPointer.current === e.pointerId && svg.current) { const scale = pan.view.width / svg.current.clientWidth; setView({ ...pan.view, x: pan.view.x - (e.clientX - pan.x) * scale, y: pan.view.y - (e.clientY - pan.y) * scale }); }
        if (activeDrag?.pointerId === e.pointerId) setDrag({ ...activeDrag, current: p });
      }}
      onPointerUp={e => {
        if (capturedPointer.current !== e.pointerId) return;
        // Commit the release coordinates, not a possibly older pointermove render.
        if (activeDrag?.pointerId === e.pointerId) {
          const positions = dragPositions(activeDrag, point(e.clientX, e.clientY));
          if (Object.keys(positions).length) props.onMove(positions);
        }
        cancelGesture();
      }} onPointerCancel={e => { if (capturedPointer.current === e.pointerId) cancelGesture(); }}
      onLostPointerCapture={e => { if (capturedPointer.current === e.pointerId) cancelGesture(); }}>
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1" fill="#d5dce3" /></pattern></defs>
      <rect className="canvas-background" x={view.x} y={view.y} width={view.width} height={view.height} fill="url(#grid)" />
      {!document.components.length && <g pointerEvents="none"><text x="500" y="270" textAnchor="middle" fontSize="24" fill="#5c6978">{props.readOnly ? '측정할 회로가 없습니다' : '첫 번째 회로를 그려볼까요?'}</text><text x="500" y="306" textAnchor="middle" fontSize="15" fill="#8290a0">{props.readOnly ? '회로 편집에서 부품을 추가하세요' : '왼쪽에서 부품을 선택하고 이곳에 놓으세요.'}</text></g>}
      {effective.wires.map(w => <g key={w.id} className="wire-element">
        <path className="wire-ink" d={wirePath(effective,w,crossings)} fill="none" stroke={candidate?.wireId===w.id ? '#3478f6' : highlighted(w.start.id) ? '#f5a623' : selected.includes(w.id) ? '#3478f6' : endColor(w.start.id)} strokeWidth={highlighted(w.start.id) ? 5 : 2.5} strokeLinejoin="round" strokeLinecap="round" />
        <polyline className="wire-hit" data-wire-id={w.id} points={pointsAttribute(wirePoints(effective, w))} fill="none" stroke="transparent" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={`도선 ${w.id}`} onClick={e => { e.stopPropagation(); if(!placement&&!wiring.active)props.onWire(w.id, snap(point(e.clientX, e.clientY))); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); const [a, b] = wirePoints(effective, w); const p={ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; if(wiring.active)wiring.activate({kind:'wire',wireId:w.id,point:p},true);else props.onWire(w.id,p); } }} />
      </g>)}
      {effective.components.map(c => {
        const select = selected.includes(c.id); const glow = props.highlightedElements?.includes(c.id);
        if(c.id===previewId)return null;
        const presentation = { label: c.label, value: componentValue(c), voltage: null, current: null };
        const textLayout=componentNotationLayout(c,presentation.label,presentation.value,14*labelScale);
        const value = presentation.value;
        return <g key={c.id} className="circuit-element" data-component-id={c.id} data-selected={select} data-highlighted={Boolean(glow)} onMouseEnter={() => props.onHoverElement?.(c.id)} onMouseLeave={() => props.onHoverElement?.(null)}>
          <g role="button" tabIndex={0} aria-pressed={select} aria-label={`${c.label} ${componentValue(c)}`} className="component" onPointerDown={e => {
            if (e.button !== 0 || capturedPointer.current !== null) return;
            if (props.readOnly) { e.stopPropagation(); props.onSelect(c.id); return; }
            if (tool === 'path') { e.stopPropagation(); props.onSelect(c.id); return; }
            if (tool !== 'select' || placement) return; e.stopPropagation();
            const ids = selected.includes(c.id) ? selected : [c.id];
            if (!selected.includes(c.id) || e.shiftKey) props.onSelect(c.id, e.shiftKey);
            if (e.shiftKey) return;
            const start = point(e.clientX, e.clientY);
            setDrag({ start, current: start, positions: Object.fromEntries(document.components.filter(x => ids.includes(x.id)).map(x => [x.id, x.position])), pointerId: e.pointerId, document });
            capturedPointer.current = e.pointerId;
            svg.current?.setPointerCapture(e.pointerId);
          }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSelect(c.id, e.shiftKey); } }} onDoubleClick={() => { if(!props.readOnly) editValue(c.id); }}>
            {/* Rotate with the symbol; keep an extra 12 screen pixels around it at every zoom. */}
            <rect className="component-hit" x="-44" y="-24" width="88" height="48" transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`} fill="transparent" stroke="transparent" strokeWidth="24" vectorEffect="non-scaling-stroke" pointerEvents="all" />
            <g className="component-lift" pointerEvents="none"><g className="component-ink" transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`} stroke="#263548" fill="white" strokeWidth="2.5" color="#263548" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: symbolMarkup(c) }} /></g>
          </g>
          {props.currentArrows?.[c.id] !== undefined && props.currentArrows[c.id] !== 0 && <g transform={`translate(${c.position.x},${c.position.y}) rotate(${c.rotation})`} stroke="#70828f" strokeWidth={Math.min(4, 1 + Math.sqrt(Math.abs(props.currentArrows[c.id])))} fill="none" pointerEvents="none"><path d={props.currentArrows[c.id] > 0 ? 'M-20 24H20 M13 19L20 24 13 29' : 'M20 24H-20 M-13 19L-20 24 -13 29'}/></g>}
          <SvgNotation x={textLayout.label.x} y={textLayout.label.y} textAnchor={textLayout.label.anchor} fontSize={14 * labelScale} fontWeight="650" fill="#344358" pointerEvents="none" symbol text={presentation.label}/>
          <SvgNotation data-value-id={c.id} className={props.readOnly ? 'component-value' : 'editable-value'} role={props.readOnly ? undefined : 'button'} tabIndex={props.readOnly ? undefined : 0} aria-label={props.readOnly ? undefined : `${c.label} 값 편집`} x={textLayout.value.x} y={textLayout.value.y} textAnchor={textLayout.value.anchor} fontSize={14 * labelScale} fill="#52647b" onClick={() => { if(!props.readOnly&&!placement) editValue(c.id); }} onKeyDown={e => { if (!props.readOnly && e.key === 'Enter') editValue(c.id); }} text={value}/>
          {[presentation.voltage && `U = ${presentation.voltage}`, presentation.current && `I = ${presentation.current}`].filter(Boolean).map((text,i)=><text key={i} x={c.position.x+(c.rotation%180?32*labelScale:0)} y={c.position.y+(c.rotation%180?38+i*22:61+i*22)*labelScale} textAnchor={c.rotation%180?'start':'middle'} fontSize={12*labelScale} fill="#506a88" pointerEvents="none">{text}</text>)}
          {c.terminals.map((t, i) => { const p = terminalPosition(c, i); return <g key={t.id} role="button" tabIndex={0} aria-label={`단자 ${t.id}`} data-endpoint-id={t.id} data-endpoint-kind="terminal" className="terminal" data-active={wiring.hint?.kind==='endpoint'&&wiring.hint.ref.id===t.id} onFocus={()=>{if(wiring.active)wiring.focusTarget(endpointTarget(document,{kind:'terminal',id:t.id}));}} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); chooseEndpoint({ kind: 'terminal', id: t.id }); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseEndpoint({ kind: 'terminal', id: t.id }); } }}>
            <circle cx={p.x} cy={p.y} r="1" fill="transparent" stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" /><circle cx={p.x} cy={p.y} r={highlighted(t.id) || isWireStart(t.id) ? 6 : 4} fill={isWireStart(t.id) ? '#3478f6' : endColor(t.id)} stroke="white" strokeWidth="1.2" />
            <title>{props.endpointLabels?.[t.id]}</title>
          </g>; })}
        </g>;
      })}
      {document.junctions.map(j => <g key={j.id} role="button" tabIndex={0} aria-label={`분기점 ${j.id}`} data-endpoint-id={j.id} data-endpoint-kind="junction" className="terminal" data-active={wiring.hint?.kind==='endpoint'&&wiring.hint.ref.id===j.id} onFocus={()=>{if(wiring.active)wiring.focusTarget(endpointTarget(document,{kind:'junction',id:j.id}));}} onClick={e => { e.stopPropagation(); chooseEndpoint({ kind: 'junction', id: j.id }); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') {e.preventDefault();e.stopPropagation();chooseEndpoint({ kind: 'junction', id: j.id });} }}>
        <circle cx={j.position.x} cy={j.position.y} r="1" fill="transparent" stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke"/><circle cx={j.position.x} cy={j.position.y} r="5" fill={highlighted(j.id) ? '#f5a623' : endColor(j.id)} />
        <title>{props.endpointLabels?.[j.id]}</title>
      </g>)}
      {document.referenceNode && (() => { const p = endpointPosition(effective, document.referenceNode!); return <g transform={`translate(${p.x},${p.y + 9})`} pointerEvents="none" stroke="#8694a5" strokeWidth="1.5"><path d="M0 0V10 M-10 10H10 M-6 14H6 M-2 18H2"/><text x={16 * labelScale} y={16 * labelScale} fill="#6a7c92" stroke="none" fontSize={11 * labelScale}>0 V</text></g>; })()}

      {callouts.map(label => <g key={label.id} pointerEvents="none"><path d={`M${label.anchor.x} ${label.anchor.y}L${label.x+label.w/2} ${label.y+label.h}`} fill="none" stroke={endColor(label.id)} strokeWidth="1" strokeDasharray="3 3"/><rect x={label.x} y={label.y} width={label.w} height={label.h} rx={5*labelScale} fill="white" stroke={endColor(label.id)}/><text x={label.x+label.w/2} y={label.y+15*labelScale} textAnchor="middle" fontSize={12*labelScale} fill={endColor(label.id)}>{label.text}</text></g>)}
      {props.probes && (['red','black'] as const).map(color => { const id=props.probes![color]; const kind=document.junctions.some(j=>j.id===id)?'junction':'terminal'; if(!document.junctions.some(j=>j.id===id)&&!document.components.some(c=>c.terminals.some(t=>t.id===id)))return null; const p=endpointPosition(effective,{kind,id}), ink=color==='red'?'#d83e44':'#263548';return <g key={color} pointerEvents="none" stroke={ink} fill="white"><circle cx={p.x} cy={p.y} r={(color==='red'?9:13)*labelScale} fill="none" strokeWidth="2"/><text x={p.x+(color==='red'?-18:18)*labelScale} y={p.y+28*labelScale} textAnchor="middle" stroke="white" paintOrder="stroke" strokeWidth="3" fill={ink} fontSize={14*labelScale}>{color==='red'?'+':'−'}</text></g>; })}
      {wireOrigin && <polyline points={pointsAttribute([wireOrigin, {x:wireOrigin.x,y:wireEnd.y}, wireEnd])} fill="none" stroke="#174895" strokeWidth="2.5" strokeDasharray="7 5" pointerEvents="none" />}
      <WiringMarks wiring={wiring} scale={drawingScale} bounds={view}/>
      {wiring.active&&!wiring.start&&crossings.map(c=><g key={c.point.x+':'+c.point.y} role="button" tabIndex={0} aria-label={'교차 '+c.horizontalId+' '+c.verticalId+' 연결 옵션'} onFocus={()=>wiring.focusTarget({kind:'crossing',crossing:c,point:c.point})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();wiring.activate({kind:'crossing',crossing:c,point:c.point},true);}}}><circle cx={c.point.x} cy={c.point.y} r={22/drawingScale} fill="transparent"/></g>)}
      {previewComponent && <g opacity=".6" pointerEvents="none" aria-label="부품 배치 미리보기"><g transform={`translate(${previewComponent.position.x},${previewComponent.position.y}) rotate(${previewComponent.rotation})`} stroke="#245cb1" fill="white" color="#245cb1" strokeWidth="2.5" dangerouslySetInnerHTML={{__html:symbolMarkup(previewComponent)}}/>{previewComponent.terminals.map((t,i)=>{const p=terminalPosition(previewComponent,i);return <circle key={t.id} cx={p.x} cy={p.y} r="4" fill="#245cb1"/>;})}</g>}
    </svg>
    {placement&&<div className="placement-status" role="status"><span>{placementMessage||(candidate?.reason==='space'?'삽입할 공간이 부족합니다':candidate?.reason==='crossing'?'교차점에서 떨어진 구간에 놓으세요':insertionPreview?.ok?'도선에 삽입 · 양쪽 단자에 연결':candidates.length>1?'삽입할 도선을 선택하세요':candidate&&placement==='voltmeter'?'전압계는 빈 공간에 놓으세요':'빈 공간에 부품 배치')}</span>{candidates.length>1&&[...new Set(candidates.map(c=>c.wireId))].map(id=><button key={id} aria-pressed={insertionWire===id} onClick={()=>{setInsertionWire(id);setPlacementMessage('');}}>{id}</button>)}<button onClick={()=>placeAt(placement,snap(pointer))}>여기에 배치</button><button onClick={props.onCancel}>취소</button></div>}
    <WiringOverlay wiring={wiring} screenPoint={screenPoint} width={viewport.width} height={viewport.height} cancel={cancelWiring}/>
    {editing&&editingComponent&&editingDefinition&&<form className="inline-value-editor" aria-label={`${editingComponent.label} 회로 위 값 편집`} style={{left:Math.max(8,Math.min(viewport.width-288,editorPoint.x-140)),top:editorTop}} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();closeEditor();}}} onSubmit={e=>{
      e.preventDefault();
      const label=editing.label.trim();
      if(!label){setEditing({...editing,error:'이름을 입력하세요.'});return;}
      const parsed=editingDefinition.property?parseQuantity(editing.draft,editingDefinition.unit):undefined;
      if(editingDefinition.property&&!parsed){setEditing({...editing,error:`유효한 ${editingDefinition.unit==='Ω'?'0 이상 저항':'전압'}을 입력하세요.`});return;}
      if(props.onCommitComponent?.(editing.id,{label,...(parsed?{value:parsed.value,...(parsed.fraction?{fraction:parsed.fraction}:{})}:{})}))closeEditor();
      else setEditing({...editing,error:'이 회로에서는 이름·값을 바꿀 수 없습니다.'});
    }}>
      <label htmlFor="inline-component-name">이름</label>
      <div className="inline-name-row"><input ref={editingDefinition.property?undefined:inlineInput} id="inline-component-name" aria-label={`${editingComponent.label} 회로 위 이름`} maxLength={160} value={editing.label} onChange={e=>setEditing({...editing,label:e.target.value,error:''})}/><span className="inline-name-preview" aria-label="이름 미리보기"><Notation symbol text={editing.label}/></span></div>
      {editingDefinition.property&&<><label htmlFor="inline-component-value">{editingDefinition.unit==='Ω'?'저항값':'전압'}</label><div><input ref={inlineInput} id="inline-component-value" aria-label={`${editingComponent.label} 회로 위 값`} value={editing.draft} aria-invalid={Boolean(editing.error)} aria-describedby={editing.error?'inline-value-error':undefined} onChange={e=>setEditing({...editing,draft:e.target.value,error:''})}/><span>{editingDefinition.unit}</span></div></>}
      <div className="inline-edit-actions"><button className="primary" type="submit">적용</button><button type="button" onClick={closeEditor}>취소</button></div>
      {editing.error&&<p id="inline-value-error" role="alert">{editing.error}</p>}
    </form>}
    {!props.readOnly&&!placement&&!editing&&props.onAction&&selected.some(id=>document.components.some(c=>c.id===id))&&<div className="canvas-selection-tools" style={{left:Math.max(8,Math.min(viewport.width-260,selectionPoint.x-126)),right:'auto',top:Math.max(10,selectionPoint.y-Math.max(130,110*drawingScale))}} aria-label="선택 부품 도구"><button onClick={()=>editValue(selected[0],true)}>이름·값 편집</button><button onClick={()=>props.onAction?.('rotate')}>회전</button><button onClick={()=>props.onAction?.('copy')}>복사</button><button onClick={()=>props.onAction?.('delete')}>삭제</button></div>}
    <div className="canvas-view-tools"><button onClick={() => zoom(.8)} aria-label="확대">＋</button><span>{Math.round(100000 / view.width)}%</span><button onClick={() => zoom(1.25)} aria-label="축소">−</button><button onClick={() => setView(documentBounds(document, 110))}>전체 보기</button></div>
    <div className="canvas-caption"><span className="small-dot" />{props.readOnly ? '측정 회로' : '이상적인 직류 회로'}</div>
  </div>;
}

