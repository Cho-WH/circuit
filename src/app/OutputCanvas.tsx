import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { CircuitDocument, Point, SimulationResult } from '../domain';
import { annotationPlacements, wirePoints } from '../component-library';
import { createSvgExport, type ExportOptions } from '../export';
import { previewCommand, type Command } from '../editor';

export type OutputTool = 'select' | 'point' | 'arrow' | 'note';
interface Props {
  document: CircuitDocument; result: SimulationResult;
  options: ExportOptions; selected: string[]; tool: OutputTool;
  onSelect: (id: string | null) => void; onTool: (tool: OutputTool) => void;
  dispatch: (command: Command) => boolean; newId: (prefix: string) => string;
}
type Target = { id: string; part: string };
type Gesture = { pointer: number; start: Point; client: Point; scale: number; view: {x:number;y:number;width:number;height:number}; target: Target | null; document: CircuitDocument; moved: boolean };

/** Output positions use document coordinates; the circuit itself cannot move here. */
export function outputMoveCommand(doc: CircuitDocument, target: Target, delta: Point): Command | null {
  if (target.part === 'body') return null;
  const annotation = annotationPlacements(doc).find(a => a.annotation.id === target.id);
  if (annotation) {
    const { x, y } = annotation;
    const end = annotation.annotation.end ?? { x: x + 64, y };
    if (target.part === 'end') return { type: 'UpdateAnnotation', id: target.id, changes: { end: { x: end.x + delta.x, y: end.y + delta.y } } };
    const position = { x: x + delta.x, y: y + delta.y };
    return { type: 'UpdateAnnotation', id: target.id, changes: { anchor: null, position,
      ...(annotation.annotation.kind === 'arrow' ? { end: target.part === 'start' ? end : { x: end.x + delta.x, y: end.y + delta.y } } : {}) } };
  }
  const component = doc.components.find(c => c.id === target.id);
  if (!component) return null;
  const prefix = target.part === 'value' ? 'answer' : target.part;
  return { type: 'SetProperties', id: target.id, properties: {
    [prefix+'OffsetX']: Number(component.properties[prefix+'OffsetX'] ?? 0) + delta.x,
    [prefix+'OffsetY']: Number(component.properties[prefix+'OffsetY'] ?? 0) + delta.y,
  } };
}

function snapToWire(doc: CircuitDocument, p: Point, radius: number): Point {
  let best = p, distance = radius;
  for (const wire of doc.wires) {
    const points = wirePoints(doc, wire);
    for (let i = 1; i < points.length; i++) {
      const a = points[i-1], b = points[i], dx = b.x-a.x, dy = b.y-a.y;
      const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
      const q = {x:a.x+t*dx,y:a.y+t*dy}, d = Math.hypot(q.x-p.x,q.y-p.y);
      if (d < distance) {best=q;distance=d;}
    }
  }
  return best;
}

export function OutputCanvas(props: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<CircuitDocument | null>(null);
  const options = props.options;
  const scene = useMemo(() => createSvgExport(preview ?? props.document, props.options, props.result), [preview, props.document, props.options, props.result]);
  const [view, setView] = useState(scene.bounds);
  const [screenScale,setScreenScale]=useState(1);
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(()=>{
    const sync=()=>setScreenScale(svg.current?.getScreenCTM?.()?.a||1);
    const observer=new ResizeObserver(sync);
    if(svg.current)observer.observe(svg.current);
    sync();return()=>observer.disconnect();
  },[view]);
  const hitRadius=22/screenScale;
  function cancel() { gesture.current = null; setPreview(null); }
  useEffect(() => {cancel();}, [props.document, props.tool]);
  useEffect(() => {
    const id=props.selected[0];
    if(!id)setTarget(null);
    else setTarget(current=>current?.id===id?current:{id,part:props.document.annotations.some(a=>a.id===id)?'annotation':'body'});
  }, [props.selected]);
  useEffect(() => {
    for (const element of svg.current?.querySelectorAll<SVGElement>('g[data-output-id]') ?? []) {
      const id=element.getAttribute('data-output-id')!;
      element.setAttribute('data-selected',String(props.selected.includes(id)));
      element.setAttribute('tabindex','0');
      element.setAttribute('role','button');
      const parts:Record<string,string>={body:'기호',label:'이름',value:'값',annotation:'장식',start:'시작점',end:'끝점',voltage:'전압',current:'전류'};
      element.setAttribute('aria-label',`${props.document.components.find(c=>c.id===id)?.label??props.document.annotations.find(a=>a.id===id)?.content??id} ${parts[element.getAttribute('data-output-part')!]??''}`);
    }
  }, [scene.content, props.selected, props.document]);
  useEffect(() => {setView(createSvgExport(props.document, options, props.result).bounds);}, [props.document.documentId]);
  useEffect(() => {
    const blur = () => cancel();
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, []);
  const point = (event: {clientX:number;clientY:number}): Point => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return {x:0,y:0};
    const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    return {x:p.x,y:p.y};
  };
  function moveCommand(g: Gesture, p: Point) {
    return g.target ? outputMoveCommand(g.document,g.target,{x:p.x-g.start.x,y:p.y-g.start.y}) : null;
  }
  function finish(e: ReactPointerEvent<SVGSVGElement>) {
    const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;
    const p={x:g.start.x+(e.clientX-g.client.x)/g.scale,y:g.start.y+(e.clientY-g.client.y)/g.scale};
    const moved=g.moved || Math.hypot(e.clientX-g.client.x,e.clientY-g.client.y)>4;
    cancel();
    if(props.tool!=='select'&&!moved) {
      const position=snapToWire(props.document,p,8/(svg.current?.getScreenCTM?.()?.a||1));
      const id=props.newId('note-');
      if(props.dispatch({type:'AddAnnotation',annotation:{id,kind:props.tool,anchor:null,position,
        ...(props.tool==='arrow'?{end:{x:position.x+64,y:position.y}}:{}),
        content:props.tool==='point'?'A':props.tool==='arrow'?'I':'글자',visibility:'always'}})) {
        props.onTool('select');props.onSelect(id);setTarget({id,part:'annotation'});
      }
    } else if(moved&&Math.hypot(p.x-g.start.x,p.y-g.start.y)>.001) {const command=moveCommand(g,p);if(command)props.dispatch(command);}
  }
  const selectedAnnotation=annotationPlacements(preview??props.document).find(a=>props.selected.includes(a.annotation.id));
  function zoom(factor:number) {setView(v=>{const width=Math.max(160,Math.min(6000,v.width*factor)),height=width*v.height/v.width;return {x:v.x+(v.width-width)/2,y:v.y+(v.height-height)/2,width,height};});}
  return <div className="output-canvas-wrap">
    <svg ref={svg} className="output-canvas" aria-label="회로도 출력 편집" tabIndex={0} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      onPointerDown={e=>{
        if(gesture.current){if(gesture.current.pointer!==e.pointerId)cancel();return;}
        if(e.button!==0)return;
        const element=(e.target as Element).closest('[data-output-id]');
        const hit=element?{id:element.getAttribute('data-output-id')!,part:element.getAttribute('data-output-part')!}:null;
        if(hit&&(hit.part==='start'||hit.part==='end')) {
          const a=annotationPlacements(props.document).find(a=>a.annotation.id===hit.id),p=point(e);
          if(a){const end=a.annotation.end??{x:a.x+64,y:a.y};hit.part=Math.hypot(p.x-a.x,p.y-a.y)<Math.hypot(p.x-end.x,p.y-end.y)?'start':'end';}
        }
        gesture.current={pointer:e.pointerId,start:point(e),client:{x:e.clientX,y:e.clientY},scale:svg.current?.getScreenCTM?.()?.a||1,view,target:props.tool==='select'?hit:null,document:props.document,moved:false};
        e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus();
        if(props.tool==='select'){setTarget(hit);props.onSelect(hit?.id??null);}
      }}
      onPointerMove={e=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;const dx=e.clientX-g.client.x,dy=e.clientY-g.client.y;if(Math.hypot(dx,dy)<4&&!g.moved)return;g.moved=true;const p={x:g.start.x+dx/g.scale,y:g.start.y+dy/g.scale};const command=moveCommand(g,p);if(command){const next=previewCommand(g.document,command);if(next.ok)setPreview(next.document);}else if(!g.target&&props.tool==='select')setView({...g.view,x:g.view.x-dx/g.scale,y:g.view.y-dy/g.scale});}}
      onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
      onFocus={e=>{const el=(e.target as Element).closest('[data-output-id]');if(el)setTarget({id:el.getAttribute('data-output-id')!,part:el.getAttribute('data-output-part')!});}}
      onKeyDown={e=>{
        const focused=(e.target as Element).closest('[data-output-id]');
        if(e.key==='Enter'&&props.tool==='select'&&focused){props.onSelect(focused.getAttribute('data-output-id')!);return;}
        if(e.key==='Escape'){cancel();props.onTool('select');return;}
        if(e.key==='Enter'&&props.tool!=='select') {
          const position={x:view.x+view.width/2,y:view.y+view.height/2},id=props.newId('note-');
          if(props.dispatch({type:'AddAnnotation',annotation:{id,kind:props.tool,anchor:null,position,content:props.tool==='point'?'A':props.tool==='arrow'?'I':'글자',visibility:'always'}})){props.onSelect(id);setTarget({id,part:'annotation'});props.onTool('select');}
        }
        if(e.key.startsWith('Arrow')&&target){e.preventDefault();e.stopPropagation();svg.current?.focus();const step=e.shiftKey?10:2;const command=outputMoveCommand(props.document,target,{x:e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,y:e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0});if(command)props.dispatch(command);}
      }}>
      <g dangerouslySetInnerHTML={{__html:scene.content}}/>
      {props.document.components.map(c=><rect key={c.id} data-output-id={c.id} data-output-part="body" x={c.position.x-24} y={c.position.y-24} width={48} height={48} fill="transparent" tabIndex={0} role="button" aria-label={`${c.label} 표기 편집`} onFocus={()=>setTarget({id:c.id,part:'body'})} onKeyDown={e=>{if(e.key==='Enter')props.onSelect(c.id);}}/>)}
      {annotationPlacements(preview??props.document).map(({annotation:a,x,y})=>a.kind==='point'?<circle key={a.id} data-output-id={a.id} data-output-part="annotation" cx={x} cy={y} r={hitRadius} fill="transparent"/>:a.kind==='arrow'?<path key={a.id} data-output-id={a.id} data-output-part="annotation" d={`M${x} ${y}L${a.end?.x??x+64} ${a.end?.y??y}`} stroke="transparent" strokeWidth={2*hitRadius} fill="none" style={{pointerEvents:'stroke'}}/>:null)}
      {selectedAnnotation?.annotation.kind==='arrow'&&[ {part:'start',x:selectedAnnotation.x,y:selectedAnnotation.y}, {part:'end',...(selectedAnnotation.annotation.end??{x:selectedAnnotation.x+64,y:selectedAnnotation.y})} ].map(p=><g key={p.part} data-output-id={selectedAnnotation.annotation.id} data-output-part={p.part}><circle cx={p.x} cy={p.y} r={hitRadius} fill="transparent"/><circle cx={p.x} cy={p.y} r={5/screenScale} fill="white" stroke="#174895" strokeWidth={2/screenScale} pointerEvents="none"/></g>)}
    </svg>
    <div className="output-zoom"><button aria-label="출력 확대" onClick={()=>zoom(.8)}><Plus size={16}/></button><button aria-label="출력 축소" onClick={()=>zoom(1.25)}><Minus size={16}/></button><button aria-label="출력 전체 맞춤" onClick={()=>setView(scene.bounds)}><Maximize size={16}/></button></div>
  </div>;
}
