import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { CircuitDocument, Point, SimulationResult } from '../domain';
import { annotationPlacements, arrowGeometry, arrowStyle, resizeArrow, wirePoints } from '../component-library';
import { createSvgExport, type ExportOptions } from '../export';
import { previewCommand, type Command } from '../editor';
import { useTouchNavigation } from './useTouchNavigation';
import { useCanvasViewport } from './useCanvasViewport';

export type OutputTool = 'select' | 'point' | 'arrow' | 'corner-arrow' | 'note';
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
    if(annotation.annotation.kind==='arrow'&&(target.part==='label'||target.part==='value')) {
      const prefix=target.part==='label'?'label':'answer',presentation=annotation.annotation.presentation??{};
      return {type:'UpdateAnnotation',id:target.id,changes:{presentation:{...presentation,[prefix+'OffsetX']:Number(presentation[prefix+'OffsetX']??0)+delta.x,[prefix+'OffsetY']:Number(presentation[prefix+'OffsetY']??0)+delta.y}}};
    }
    if(annotation.annotation.kind==='arrow'&&(target.part==='start'||target.part==='end')) {
      const changes=resizeArrow(annotation.annotation,{x,y},target.part,delta);
      const current=arrowStyle(annotation.annotation,{x,y});
      if(changes.arrow.length===current.length&&changes.arrow.legLength===current.legLength)return null;
      return {type:'UpdateAnnotation',id:target.id,changes};
    }
    const end = annotation.annotation.end ?? { x: x + 64, y };
    const position = { x: x + delta.x, y: y + delta.y };
    return { type: 'UpdateAnnotation', id: target.id, changes: { anchor: null, position,
      ...(annotation.annotation.kind === 'arrow' ? { arrow: arrowStyle(annotation.annotation,{x,y}), end: { x: end.x + delta.x, y: end.y + delta.y } } : {}) } };
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
  const [touchInput,setTouchInput]=useState(false);
  const [choices,setChoices]=useState<Target[]>([]);
  const skipClick=useRef(false);
  useEffect(()=>{setChoices([]);},[view]);
  const touchNavigation=useTouchNavigation(view,setView,screenScale,()=>{cancel();setChoices([]);});
  useCanvasViewport(svg,view,setView,()=>{cancel();touchNavigation.reset();setChoices([]);},props.document.components.find(c=>c.id===props.selected[0])?.position);
  useEffect(()=>{
    const sync=()=>setScreenScale(svg.current?.getScreenCTM?.()?.a||1);
    const observer=new ResizeObserver(sync);
    if(svg.current)observer.observe(svg.current);
    sync();return()=>observer.disconnect();
  },[view]);
  const hitRadius=22/screenScale;
  function cancel() { gesture.current = null; setPreview(null); }
  useEffect(() => {cancel();touchNavigation.reset();setChoices([]);}, [props.document, props.tool]);
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
      const parts:Record<string,string>={body:'기호',label:'이름',value:'값',annotation:'장식',start:'시작 쪽 길이 조절',end:'끝 쪽 길이 조절',voltage:'전압',current:'전류'};
      const annotation=props.document.annotations.find(a=>a.id===id);
      element.setAttribute('aria-label',`${props.document.components.find(c=>c.id===id)?.label??annotation?.presentation?.labelText??annotation?.content??id} ${parts[element.getAttribute('data-output-part')!]??''}`);
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
    cancel();skipClick.current=moved;
    const rect=e.currentTarget.getBoundingClientRect();
    if(rect.width&&(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom))return;
    if(props.tool!=='select'&&!moved) {
      const position=snapToWire(props.document,p,8/(svg.current?.getScreenCTM?.()?.a||1));
      const id=props.newId('note-');
      if(props.dispatch({type:'AddAnnotation',annotation:{id,kind:props.tool==='corner-arrow'?'arrow':props.tool,anchor:null,position,
        ...((props.tool==='arrow'||props.tool==='corner-arrow')?{arrow:{shape:props.tool==='corner-arrow'?'corner' as const:'straight' as const,length:64,legLength:48,rotation:0,reversed:false}}:{}),
        content:props.tool==='point'?'A':(props.tool==='arrow'||props.tool==='corner-arrow')?'I':'글자',visibility:'always'}})) {
        props.onTool('select');props.onSelect(id);setTarget({id,part:'annotation'});
      }
    } else if(moved&&Math.hypot(p.x-g.start.x,p.y-g.start.y)>.001) {const command=moveCommand(g,p);if(command)props.dispatch(command);}
  }
  function zoom(factor:number) {setView(v=>{const width=Math.max(160,Math.min(6000,v.width*factor)),height=width*v.height/v.width;return {x:v.x+(v.width-width)/2,y:v.y+(v.height-height)/2,width,height};});}
  function hitTarget(element:Element|null):Target|null { const el=element?.closest('[data-output-id]');return el?{id:el.getAttribute('data-output-id')!,part:el.getAttribute('data-output-part')!}:null; }
  function touchTargets(x:number,y:number):Target[] {
    const hits=new Map<string,Target>();
    const p=point({clientX:x,clientY:y});
    for(const el of svg.current?.querySelectorAll<SVGElement>('[data-output-id]')??[]){
      const hit=hitTarget(el)!;
      const annotation=props.document.annotations.find(a=>a.id===hit.id);
      if(hit.part==='annotation'&&annotation&&(annotation.kind==='arrow'||annotation.kind==='point'))continue;
      const rect=el.getBoundingClientRect();if(!rect.width&&!rect.height)continue;
      const padX=Math.max(0,(44-rect.width)/2),padY=Math.max(0,(44-rect.height)/2);
      if(x>=rect.left-padX&&x<=rect.right+padX&&y>=rect.top-padY&&y<=rect.bottom+padY){const hit=hitTarget(el)!;hits.set(hit.id+':'+hit.part,hit);}
    }
    for(const a of annotationPlacements(props.document)){
      const points=a.annotation.kind==='point'?[a,a]:a.annotation.kind==='arrow'?arrowGeometry(a.annotation,a).points:[];
      if(points.slice(1).some((b,i)=>{const first=points[i],dx=b.x-first.x,dy=b.y-first.y,t=Math.max(0,Math.min(1,((p.x-first.x)*dx+(p.y-first.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(first.x+t*dx-p.x,first.y+t*dy-p.y)*screenScale<=22;}))hits.set(a.annotation.id+':annotation',{id:a.annotation.id,part:'annotation'});
    }
    return [...hits.values()];
  }
  function choose(hit:Target|null){setTarget(hit);setChoices([]);props.onSelect(hit?.id??null);}
  function beginTouchDrag(hit:Target,e:{pointerId:number;clientX:number;clientY:number}) {
    gesture.current={pointer:e.pointerId,start:point(e),client:{x:e.clientX,y:e.clientY},scale:svg.current?.getScreenCTM?.()?.a||1,view,target:hit,document:props.document,moved:false};
    svg.current?.setPointerCapture(e.pointerId);choose(hit);
  }
  const partNames:Record<string,string>={body:'기호',label:'이름',value:'값',annotation:'장식',start:'시작점',end:'끝점',voltage:'전압',current:'전류'};
  const targetName=(t:Target)=>`${props.document.components.find(c=>c.id===t.id)?.label??props.document.annotations.find(a=>a.id===t.id)?.content??t.id} · ${partNames[t.part]??t.part}`;
  function nudge(delta:Point){if(!target)return;const command=outputMoveCommand(props.document,target,delta);if(command)props.dispatch(command);}
  return <div className="output-canvas-wrap" data-touch={touchInput||undefined} data-gesture={gesture.current?.moved?'dragging':touchNavigation.state}>
    <svg ref={svg} className="output-canvas" aria-label="회로도 출력 편집" tabIndex={0} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      onContextMenu={e=>{if(touchInput)e.preventDefault();}}
      onPointerDownCapture={e=>{
        setTouchInput(e.pointerType==='touch');skipClick.current=false;if(e.pointerType!=='touch'){touchNavigation.down(e,false);return;}
        const direct=hitTarget(e.target as Element),handle=direct&&(direct.part==='start'||direct.part==='end')?direct:null;
        const hits=touchTargets(e.clientX,e.clientY),hit=handle??hits.find(h=>h.id===target?.id&&h.part===target.part&&props.selected.includes(h.id))??(hits.length===1?hits[0]:hits.length>1?null:direct);
        const selected=hit&&props.selected.includes(hit.id)&&(handle||hits.length<=1||target?.id===hit.id&&target.part===hit.part);
        const data={pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY};
        if(touchNavigation.down(e,!selected||props.tool!=='select',!selected&&hit&&hit.part!=='body'&&props.tool==='select'?()=>beginTouchDrag(hit,data):undefined))e.stopPropagation();
        else if(selected&&hit){beginTouchDrag(hit,data);e.stopPropagation();}
      }}
      onPointerMoveCapture={e=>{if(touchNavigation.move(e)){setChoices([]);e.stopPropagation();}}}
      onPointerUpCapture={e=>{if(touchNavigation.up(e))e.stopPropagation();}}
      onPointerCancelCapture={e=>{touchNavigation.up(e,true);skipClick.current=true;}}
      onClickCapture={e=>{
        if(!touchInput)return;e.stopPropagation();if(touchNavigation.consumeClick()||skipClick.current)return;
        const hitElement=svg.current?.ownerDocument.elementFromPoint?.(e.clientX,e.clientY)??e.target as Element;
        if(props.tool==='select'){
          const hits=touchTargets(e.clientX,e.clientY);if(hits.length>1){setChoices(hits);return;}choose(hits[0]??hitTarget(hitElement));
        }else{
          const id=props.newId('note-'),position=snapToWire(props.document,point(e),8/screenScale);
          if(props.dispatch({type:'AddAnnotation',annotation:{id,kind:props.tool==='corner-arrow'?'arrow':props.tool,anchor:null,position,...((props.tool==='arrow'||props.tool==='corner-arrow')?{arrow:{shape:props.tool==='corner-arrow'?'corner' as const:'straight' as const,length:64,legLength:48,rotation:0,reversed:false}}:{}),content:props.tool==='point'?'A':(props.tool==='arrow'||props.tool==='corner-arrow')?'I':'글자',visibility:'always'}})){props.onTool('select');choose({id,part:'annotation'});}
        }
      }}
      onPointerDown={e=>{
        if(gesture.current){if(gesture.current.pointer!==e.pointerId)cancel();return;}
        if(e.button!==0)return;
        const element=(e.target as Element).closest('[data-output-id]');
        const hit=element?{id:element.getAttribute('data-output-id')!,part:element.getAttribute('data-output-part')!}:null;
        if(hit&&(hit.part==='start'||hit.part==='end')) {
          const placement=annotationPlacements(props.document).find(p=>p.annotation.id===hit.id);
          if(placement){const points=arrowGeometry(placement.annotation,placement).points,p=point(e),first=points[0],last=points.at(-1)!;hit.part=Math.hypot(p.x-first.x,p.y-first.y)<Math.hypot(p.x-last.x,p.y-last.y)?'start':'end';}
        }
        gesture.current={pointer:e.pointerId,start:point(e),client:{x:e.clientX,y:e.clientY},scale:svg.current?.getScreenCTM?.()?.a||1,view,target:props.tool==='select'?hit:null,document:props.document,moved:false};
        e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus();
        if(props.tool==='select'){setTarget(hit);props.onSelect(hit?.id??null);}
      }}
      onPointerMove={e=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;const dx=e.clientX-g.client.x,dy=e.clientY-g.client.y;if(Math.hypot(dx,dy)<4&&!g.moved)return;g.moved=true;const p={x:g.start.x+dx/g.scale,y:g.start.y+dy/g.scale};const command=moveCommand(g,p);if(command){const next=previewCommand(g.document,command);if(next.ok)setPreview(next.document);}else if(!g.target&&props.tool==='select')setView({...g.view,x:g.view.x-dx/g.scale,y:g.view.y-dy/g.scale});}}
      onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={e=>{touchNavigation.lost(e);cancel();}}
      onFocus={e=>{const el=(e.target as Element).closest('[data-output-id]');if(el)setTarget({id:el.getAttribute('data-output-id')!,part:el.getAttribute('data-output-part')!});}}
      onKeyDown={e=>{
        const focused=(e.target as Element).closest('[data-output-id]');
        if(e.key==='Enter'&&props.tool==='select'&&focused){props.onSelect(focused.getAttribute('data-output-id')!);return;}
        if(e.key==='Escape'){cancel();touchNavigation.reset();setChoices([]);props.onTool('select');return;}
        if(e.key==='Enter'&&props.tool!=='select') {
          const position={x:view.x+view.width/2,y:view.y+view.height/2},id=props.newId('note-');
          if(props.dispatch({type:'AddAnnotation',annotation:{id,kind:props.tool==='corner-arrow'?'arrow':props.tool,anchor:null,position,...((props.tool==='arrow'||props.tool==='corner-arrow')?{arrow:{shape:props.tool==='corner-arrow'?'corner' as const:'straight' as const,length:64,legLength:48,rotation:0,reversed:false}}:{}),content:props.tool==='point'?'A':(props.tool==='arrow'||props.tool==='corner-arrow')?'I':'글자',visibility:'always'}})){props.onSelect(id);setTarget({id,part:'annotation'});props.onTool('select');}
        }
        if(e.key.startsWith('Arrow')&&target){e.preventDefault();e.stopPropagation();svg.current?.focus();const step=e.shiftKey?10:2;const command=outputMoveCommand(props.document,target,{x:e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,y:e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0});if(command)props.dispatch(command);}
      }}>
      {annotationPlacements(preview??props.document).map(({annotation:a,x,y})=>a.kind==='point'?<circle key={a.id} data-output-id={a.id} data-output-part="annotation" cx={x} cy={y} r={hitRadius} fill="transparent"/>:a.kind==='arrow'?<path key={a.id} data-output-id={a.id} data-output-part="annotation" d={arrowGeometry(a,{x,y}).path} stroke="transparent" strokeWidth={2*hitRadius} fill="none" style={{pointerEvents:'stroke'}}/>:null)}
      <g dangerouslySetInnerHTML={{__html:scene.content}}/>
      {props.document.components.map(c=><rect key={c.id} data-output-id={c.id} data-output-part="body" x={c.position.x-24} y={c.position.y-24} width={48} height={48} fill="transparent" tabIndex={0} role="button" aria-label={`${c.label} 표기 편집`} onFocus={()=>setTarget({id:c.id,part:'body'})} onKeyDown={e=>{if(e.key==='Enter')props.onSelect(c.id);}}/>)}

      {annotationPlacements(preview??props.document).filter(p=>p.annotation.kind==='arrow'&&props.selected.includes(p.annotation.id)).flatMap(p=>{
        const points=arrowGeometry(p.annotation,p).points;
        return [{part:'start',point:points[0]},{part:'end',point:points.at(-1)!}].map(({part,point})=><g key={p.annotation.id+part} data-output-id={p.annotation.id} data-output-part={part} style={{cursor:'grab'}}>
          <circle cx={point.x} cy={point.y} r={hitRadius} fill="transparent"/>
          <circle cx={point.x} cy={point.y} r={5/screenScale} fill="white" stroke="#174895" strokeWidth={1.5/screenScale} pointerEvents="none"/>
        </g>);
      })}
    </svg>
    {choices.length>0&&<div className="touch-choice-list" aria-label="겹친 출력 대상 선택"><span>옮길 대상을 선택하세요</span>{choices.map(t=><button key={t.id+':'+t.part} onClick={()=>choose(t)}>{targetName(t)}</button>)}<button onClick={()=>setChoices([])}>취소</button></div>}
    {target&&target.part!=='body'&&props.selected.includes(target.id)&&<div className="output-position-tools" aria-label="선택 표기 위치 조절"><span>{targetName(target)}</span><button aria-label="표기 왼쪽으로" onClick={()=>nudge({x:-2,y:0})}>←</button><button aria-label="표기 위로" onClick={()=>nudge({x:0,y:-2})}>↑</button><button aria-label="표기 아래로" onClick={()=>nudge({x:0,y:2})}>↓</button><button aria-label="표기 오른쪽으로" onClick={()=>nudge({x:2,y:0})}>→</button></div>}
    <div className="output-zoom"><button aria-label="출력 확대" onClick={()=>zoom(.8)}><Plus size={16}/></button><button aria-label="출력 축소" onClick={()=>zoom(1.25)}><Minus size={16}/></button><button aria-label="출력 전체 맞춤" onClick={()=>setView(scene.bounds)}><Maximize size={16}/></button></div>
  </div>;
}
