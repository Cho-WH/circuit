import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Layers3, RotateCcw, MoveUpRight, ScanLine, Eye, EyeOff } from 'lucide-react';
import type { CircuitDocument } from '../domain';
import type { PotentialModel } from '../visualization';
import { formatQuantity, terminalPosition } from '../component-library';
import { exportSvg } from '../export';
import { sceneAnchors, sceneExtent, selectedVoltage } from './model';
import './styles.css';
export { voltageTicks, sceneAnchors, sceneExtent, selectedVoltage } from './model';

export interface Potential3DProps {
  document: CircuitDocument;
  potential: PotentialModel;
  referenceLabel: string;
  selectedIds: string[];
  highlightedId?: string | null;
  selectedNet?: string | null;
  showNumbers: boolean;
  showColors: boolean;
  onSelect?: (id: string) => void;
}
type Preset = 'oblique' | 'front' | 'top';
type Label = { element: HTMLElement; point: THREE.Vector3; lifted: boolean; priority: number };
interface Runtime {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  floor: THREE.Group;
  content: THREE.Group;
  raised: THREE.Group;
  labels: Label[];
  bounds: THREE.Box3;
  width: number;
  height: number;
  frustum: number;
  frame: number;
  progress: number;
  framed: boolean;
  documentId?: string;
  preset: Preset;
  render: () => void;
  stop: () => void;
}
const point = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, -p.y, p.z);
function dispose(group: THREE.Object3D) {
  group.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : [];
    materials.forEach(material => { (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose(); });
  });
}
function line(group: THREE.Group, points: THREE.Vector3[], color: string, dashed = false, opacity = 1) {
  const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 4, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
  if (dashed) object.computeLineDistances();
  group.add(object);
  return object;
}
function tube(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, color: string, radius: number, id: string) {
  if (a.distanceTo(b) < .001) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), new THREE.MeshBasicMaterial({ color }));
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.userData.id = id;
  group.add(mesh);
}
function projection(r: Runtime) {
  const aspect = r.width / Math.max(r.height, 1);
  r.camera.left = -r.frustum * aspect / 2; r.camera.right = r.frustum * aspect / 2;
  r.camera.top = r.frustum / 2; r.camera.bottom = -r.frustum / 2;
  r.camera.updateProjectionMatrix();
}
function cameraPose(r: Runtime, preset: Preset) {
  const center = r.bounds.getCenter(new THREE.Vector3());
  const size = r.bounds.getSize(new THREE.Vector3());
  const distance = Math.max(size.x, size.y, size.z, 100) * 4 + 400;
  r.preset = preset;
  r.controls.target.copy(center);
  r.camera.up.set(0, preset === 'top' ? 1 : 0, preset === 'top' ? 0 : 1);
  const direction = preset === 'top' ? new THREE.Vector3(0, 0, 1) : preset === 'front' ? new THREE.Vector3(0, -1, .001) : new THREE.Vector3(.25, -1, .95).normalize();
  r.camera.position.copy(center).addScaledVector(direction, distance);
  r.camera.near = .1; r.camera.far = distance * 10;
  r.camera.zoom = 1; r.camera.lookAt(center); r.camera.updateMatrixWorld(true);
  const projected = new THREE.Box3();
  for (const x of [r.bounds.min.x, r.bounds.max.x]) for (const y of [r.bounds.min.y, r.bounds.max.y]) for (const z of [r.bounds.min.z, r.bounds.max.z]) projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(r.camera.matrixWorldInverse));
  const span = projected.getSize(new THREE.Vector3());
  r.frustum = Math.max(span.y, span.x / (r.width / Math.max(1, r.height)), 100) * 1.18;
  projection(r); r.controls.update(); r.render();
}

export function Potential3D(props: Potential3DProps) {
  const { document: circuit, potential, referenceLabel, selectedIds, highlightedId, selectedNet, showNumbers, showColors } = props;
  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null), latest = useRef(props);
  latest.current = props;
  const [fallback, setFallback] = useState(false);
  const [preset, setPreset] = useState<Preset>('oblique');
  const [guides, setGuides] = useState(true);
  const selection = selectedVoltage(circuit, potential, selectedIds[0]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setFallback(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf8fafc, 0);
    renderer.domElement.setAttribute('aria-label', '바닥 회로도와 전위 높이 지도. 도선 또는 부품을 눌러 값을 확인하세요.');
    renderer.domElement.setAttribute('role', 'img');
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; controls.screenSpacePanning = true; controls.minZoom = .3; controls.maxZoom = 8;
    const floor = new THREE.Group(), content = new THREE.Group(), raised = new THREE.Group();
    content.add(raised); scene.add(floor, content);
    const r: Runtime = { scene, camera, renderer, controls, floor, content, raised, labels: [], bounds: new THREE.Box3(new THREE.Vector3(-100,-100,0), new THREE.Vector3(100,100,100)), width: 1, height: 1, frustum: 500, frame: 0, progress: 1, framed: false, preset: 'oblique', render: () => {}, stop: () => {} };
    r.render = () => {
      renderer.render(scene, camera);
      const occupied: { x: number; y: number; w: number; h: number }[] = [];
      for (const label of [...r.labels].sort((a,b) => b.priority-a.priority)) {
        const p = label.point.clone(); if (label.lifted) p.z *= r.progress;
        p.project(camera);
        const x = (p.x + 1) * r.width / 2, y = (1 - p.y) * r.height / 2;
        const w = label.element.offsetWidth || 52, h = label.element.offsetHeight || 25;
        const rect = { x: x - w / 2, y: label.element.classList.contains('axis-tag') ? y - h / 2 : y - h - 9, w, h };
        const hidden = p.z < -1 || p.z > 1 || rect.x < 3 || rect.x + w > r.width - 3 || rect.y < 2 || rect.y + h > r.height - 2 || occupied.some(b => rect.x < b.x+b.w+5 && rect.x+w+5 > b.x && rect.y < b.y+b.h+4 && rect.y+h+4 > b.y);
        label.element.style.visibility = hidden ? 'hidden' : 'visible';
        label.element.style.transform = `translate(${rect.x}px,${rect.y}px)`;
        if (!hidden) occupied.push(rect);
      }
    };
    r.stop = () => { cancelAnimationFrame(r.frame); const wasAnimating=!r.controls.enabled; r.progress = 1; r.raised.scale.z = 1; r.controls.enabled = true; if(wasAnimating) cameraPose(r,r.preset); };
    runtime.current = r;
    const resize = () => { const oldWidth=r.width; r.width = Math.max(1, element.clientWidth); r.height = Math.max(1, element.clientHeight); renderer.setSize(r.width, r.height, false); if(r.framed && Math.abs(oldWidth-r.width)>2) { r.stop(); cameraPose(r,r.preset); } else { projection(r); r.render(); } };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    controls.addEventListener('change', r.render);
    let start: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => { start = { x: event.clientX, y: event.clientY }; };
    const up = (event: PointerEvent) => {
      if (!start || Math.hypot(event.clientX-start.x,event.clientY-start.y)>5) { start = null; return; }
      start = null;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
      const hit = ray.intersectObjects(r.raised.children,true).find(hit => typeof hit.object.userData.id === 'string');
      if (hit) latest.current.onSelect?.(hit.object.userData.id);
      else {
        const hitPoint = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),0),new THREE.Vector3());
        if (!hitPoint) return;
        const candidate = latest.current.document.components.find(c => Math.hypot(c.position.x-hitPoint.x,c.position.y+hitPoint.y)<40);
        if (candidate) latest.current.onSelect?.(candidate.id);
      }
    };
    const lost = (event: Event) => { event.preventDefault(); r.stop(); controls.enabled = false; setFallback(true); };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      r.stop(); observer.disconnect(); controls.removeEventListener('change',r.render); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown',down); renderer.domElement.removeEventListener('pointerup',up); renderer.domElement.removeEventListener('webglcontextlost',lost);
      dispose(r.floor); dispose(r.content); renderer.dispose(); renderer.domElement.remove(); runtime.current = null;
    };
  }, []);

  // Regenerate a transparent schematic from the document and the same shared symbols as 2D/export.
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    let cancelled = false;
    const schematic = { ...circuit, components: circuit.components.map(c => ({ ...c, properties: { ...c.properties, showVoltage: false, showCurrent: false } })) };
    const svg = exportSvg(schematic, { background: 'transparent', monochrome: true, mode: 'answer', margin: 55 });
    const root = new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
    const [x,y,width,height] = root.getAttribute('viewBox')!.split(' ').map(Number);
    const url = URL.createObjectURL(new Blob([svg], { type:'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url); if (cancelled) return;
      const canvas = window.document.createElement('canvas');
      const resolution = Math.min(2, 4096 / Math.max(width,height));
      canvas.width = Math.ceil(width*resolution); canvas.height = Math.ceil(height*resolution);
      const context = canvas.getContext('2d'); if (!context) return;
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.66,side:THREE.DoubleSide,depthWrite:false});
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
      mesh.position.set(x+width/2,-y-height/2,-.25);
      dispose(r.floor); r.floor.clear(); r.floor.add(mesh); r.render();
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [circuit]);

  useEffect(() => {
    const r = runtime.current, labelHost = overlay.current; if (!r || !labelHost) return;
    r.stop(); r.scene.remove(r.content); dispose(r.content);
    r.content = new THREE.Group(); r.raised = new THREE.Group(); r.content.add(r.raised); r.scene.add(r.content);
    labelHost.replaceChildren(); r.labels = [];
    const extent = sceneExtent(circuit,potential), f = extent.floor;
    r.bounds.set(new THREE.Vector3(f.x-45,-f.y-f.height,extent.minZ-15),new THREE.Vector3(f.x+f.width,-f.y,extent.maxZ+30));
    const radius = Math.max(.9, Math.max(f.width,f.height)*.0035);
    const addLabel = (text: string, p: THREE.Vector3, className: string, lifted = false, priority = 1, id?: string) => {
      const element = window.document.createElement(id ? 'button' : 'span');
      element.className = `potential-tag ${className}`; element.textContent = text;
      if (id) { element.setAttribute('type','button'); element.setAttribute('aria-label',`${text} 선택`); element.onclick = () => latest.current.onSelect?.(id); }
      labelHost.appendChild(element); r.labels.push({element,point:p,lifted,priority});
    };
    // A sparse, transparent reference grid leaves negative voltages visible below it.
    const gridStep = Math.max(f.width,f.height)/12;
    for (let i=0;i<=12;i++) {
      const x=f.x+i*gridStep, y=f.y+i*gridStep;
      if(x<=f.x+f.width) line(r.content,[new THREE.Vector3(x,-f.y,0),new THREE.Vector3(x,-f.y-f.height,0)],'#dce5ee',false,.45);
      if(y<=f.y+f.height) line(r.content,[new THREE.Vector3(f.x,-y,0),new THREE.Vector3(f.x+f.width,-y,0)],'#dce5ee',false,.45);
    }
    const axisX=f.x-10, axisY=-f.y-f.height+20;
    line(r.content,[new THREE.Vector3(axisX,axisY,extent.minZ),new THREE.Vector3(axisX,axisY,extent.maxZ+15)],'#899eb5');
    for (const v of extent.ticks) {
      const z=v*potential.scale;
      line(r.content,[new THREE.Vector3(axisX-5,axisY,z),new THREE.Vector3(axisX+7,axisY,z)],v===0?'#5275a1':'#a6b7c9');
      addLabel(formatQuantity(v,'V'),new THREE.Vector3(axisX-20,axisY,z),'axis-tag',false,v===0?6:5);
      if(guides && v!==0) line(r.content,[new THREE.Vector3(axisX+7,axisY,z),new THREE.Vector3(f.x+f.width,axisY,z)],'#bdcddd',true,.34);
    }
    for (const segment of potential.segments) {
      const active = selectedIds.includes(segment.id) || highlightedId===segment.id || Boolean(selectedNet && potential.nets[selectedNet]?.wireIds.includes(segment.id));
      const color = active ? '#326cde' : showColors ? segment.color : '#566d88';
      segment.points.slice(1).forEach((p,i) => tube(r.raised,point(segment.points[i]),point(p),color,radius*(active?1.65:1),segment.id));
    }
    for (const anchor of sceneAnchors(circuit,potential)) {
      const net = potential.nets[anchor.id];
      const owner = net.wireIds[0] ?? circuit.components.find(c=>c.terminals.some(t=>net.endpointIds.includes(t.id)))?.id;
      const pos = point(anchor);
      if (guides && anchor.z!==0) line(r.raised,[new THREE.Vector3(pos.x,pos.y,0),pos],'#91a7bf',true,.65);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(radius*2,12,8),new THREE.MeshBasicMaterial({color:showColors?anchor.color:'#566d88'}));
      dot.position.copy(pos); if(owner) dot.userData.id=owner; r.raised.add(dot);
      if(showNumbers) addLabel(formatQuantity(anchor.voltage,'V'),pos,'net-tag',true,3,owner);
    }
    // All terminals remain visible, including the two disconnected ends of an open switch.
    for (const c of circuit.components) for (let i=0;i<c.terminals.length;i++) {
      const net=potential.endpoints[c.terminals[i].id], p=terminalPosition(c,i);
      if(net?.height===undefined) continue;
      const dot=new THREE.Mesh(new THREE.SphereGeometry(radius*1.3,8,6),new THREE.MeshBasicMaterial({color:showColors?net.color:'#566d88'}));
      dot.position.copy(point({...p,z:net.height})); dot.userData.id=c.id; r.raised.add(dot);
    }
    for (const c of circuit.components) {
      const ends = c.terminals.slice(0,2).map(t=>potential.endpoints[t.id]?.height);
      const z = ends.length===2 && ends.every(v=>v!==undefined) ? (ends[0]!+ends[1]!)/2 : 0;
      addLabel(c.label,point({...c.position,z}),'component-tag',true,2,c.id);
    }
    const selected = selectedVoltage(circuit,potential,selectedIds[0]);
    if(selected) {
      const a=point(selected.a),b=point(selected.b);
      if(guides) for(const p of [a,b]) line(r.raised,[new THREE.Vector3(p.x,p.y,0),p],'#326cde',true,.85);
      const x=(a.x+b.x)/2+20,y=(a.y+b.y)/2+20;
      line(r.raised,[new THREE.Vector3(x,y,a.z),new THREE.Vector3(x,y,b.z)],'#326cde');
      for(const z of [a.z,b.z]) line(r.raised,[new THREE.Vector3(x-5,y,z),new THREE.Vector3(x+5,y,z)],'#326cde');
      if(showNumbers) addLabel(`ΔV ${formatQuantity(selected.difference,'V')}`,new THREE.Vector3(x,y,(a.z+b.z)/2),'delta-tag',true,8);
    }
    if (!r.framed || r.documentId!==circuit.documentId) {
      r.documentId=circuit.documentId; r.framed=true; cameraPose(r,'oblique'); setPreset('oblique');
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const endPosition=r.camera.position.clone(), endRotation=r.camera.quaternion.clone(), endFrustum=r.frustum;
        const center=r.controls.target.clone(), distance=endPosition.distanceTo(center);
        const startCamera=r.camera.clone(); startCamera.up.set(0,1,0);
        startCamera.position.copy(center).add(new THREE.Vector3(0,0,distance)); startCamera.lookAt(center);
        const startPosition=startCamera.position.clone(), startRotation=startCamera.quaternion.clone();
        const size=r.bounds.getSize(new THREE.Vector3());
        const startFrustum=Math.max(size.y,size.x/(r.width/r.height))*1.18;
        const start=performance.now(); r.controls.enabled=false;
        const animate=(now:number) => {
          const t=Math.min(1,(now-start)/1100), lift=Math.min(1,t/.75);
          r.progress=1-(1-lift)**3; r.raised.scale.z=Math.max(.0001,r.progress);
          const tilt=Math.max(0,(t-.12)/.88), ease=tilt*tilt*(3-2*tilt);
          r.camera.position.lerpVectors(startPosition,endPosition,ease);
          r.camera.quaternion.slerpQuaternions(startRotation,endRotation,ease);
          r.frustum=startFrustum+(endFrustum-startFrustum)*ease; projection(r); r.render();
          if(t<1) r.frame=requestAnimationFrame(animate); else { r.controls.enabled=true; r.controls.update(); }
        };
        r.frame=requestAnimationFrame(animate);
      }
    } else r.render();
  }, [circuit,potential,selectedIds,highlightedId,selectedNet,showNumbers,showColors,guides]);

  const choose = (value: Preset) => { const r=runtime.current; if(r) {r.stop();cameraPose(r,value);setPreset(value);} };
  return <section className="potential-scene" aria-label="3D 전위 높이 보기">
    <header className="potential-scene-header"><div className="scene-toolbar" aria-label="3D 카메라 보기">
      <button aria-pressed={preset==='oblique'} onClick={()=>choose('oblique')}><MoveUpRight size={14}/>사선</button><button aria-pressed={preset==='front'} onClick={()=>choose('front')}><ScanLine size={14}/>정면</button><button aria-pressed={preset==='top'} onClick={()=>choose('top')}><Layers3 size={14}/>위에서</button><span className="scene-divider"/><button aria-label="높이 안내선" aria-pressed={guides} onClick={()=>setGuides(!guides)}>{guides?<Eye size={15}/>:<EyeOff size={15}/>}</button><button aria-label="보기 초기화" onClick={()=>choose('oblique')}><RotateCcw size={14}/></button>
    </div></header>
    <div className="potential-stage"><div className="potential-webgl" ref={host}/><div className="potential-labels" ref={overlay}/>
      {fallback&&<div className="scene-fallback" role="status"><strong>이 기기에서 3D를 표시할 수 없습니다.</strong><p>2D 전위와 경로 그래프에서 같은 값을 확인할 수 있습니다.</p></div>}
    </div>
    <footer className="scene-footer"><span className="floor-key"><i/>기준면 <b>0 V</b><small>{referenceLabel}</small></span><span className="height-key">높이 강조 <b>{(potential.scale/18).toFixed(1)}배</b></span>{potential.undefinedCount>0&&<span>전위 미정 {potential.undefinedCount}개</span>}</footer>
    {selection&&<div className="scene-selection" aria-live="polite"><strong>{selection.component.label}</strong><span>{formatQuantity(selection.a.voltage,'V')} <span aria-hidden="true">→</span> {formatQuantity(selection.b.voltage,'V')}</span><b>양단 전압 {formatQuantity(selection.difference,'V')}</b><small>단자 순서 기준 · 경사는 양단 전위 차이의 도식입니다.</small></div>}
  </section>;
}

