// @refresh reset
// The imperative WebGL runtime must not retain old render closures across code updates.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Layers3, RotateCcw, MoveUpRight, ScanLine, Eye, EyeOff } from 'lucide-react';
import type { CircuitDocument } from '../domain';
import type { PotentialModel } from '../visualization';
import { htmlNotation, formatQuantity, terminalPosition } from '../component-library';
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
  sourceView?: { x: number; y: number; width: number; height: number };
  entryDuration?: number;
  onReady?: () => void;
  onEntered?: () => void;
  onError?: (reason: 'webgl' | 'font' | 'texture' | 'context-lost') => void;
}
type Preset = 'oblique' | 'front' | 'top';
type Label = { key: string; text: string; element: HTMLElement; point: THREE.Vector3; lifted: boolean; priority: number };
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
  preset: Preset;
  render: () => void;
  stop: () => void;
  begin: () => void;
  floorReady: boolean;
  modelReady: boolean;
  ready: boolean;
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
function cameraPose(r: Runtime, preset: Preset, notify = true) {
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
  projection(r); if (notify) { r.controls.update(); r.render(); }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function cameraState(r: Runtime) {
  return { position: r.camera.position.clone(), rotation: r.camera.quaternion.clone(), up: r.camera.up.clone(), target: r.controls.target.clone(), frustum: r.frustum, zoom: r.camera.zoom };
}
function applyCamera(r: Runtime, state: ReturnType<typeof cameraState>) {
  r.camera.position.copy(state.position); r.camera.quaternion.copy(state.rotation); r.camera.up.copy(state.up);
  r.controls.target.copy(state.target); r.frustum = state.frustum; r.camera.zoom = state.zoom; projection(r);
}
// Keep the optical axis aimed at the moving target throughout the orbit.
// Interpolating position and orientation independently makes the scene drift off-center.
function interpolateCamera(r: Runtime, start: ReturnType<typeof cameraState>, end: ReturnType<typeof cameraState>, t: number) {
  r.controls.target.lerpVectors(start.target, end.target, t);
  r.camera.quaternion.slerpQuaternions(start.rotation, end.rotation, t);
  const distance = THREE.MathUtils.lerp(start.position.distanceTo(start.target), end.position.distanceTo(end.target), t);
  r.camera.position.set(0, 0, distance).applyQuaternion(r.camera.quaternion).add(r.controls.target);
  r.camera.up.set(0, 1, 0).applyQuaternion(r.camera.quaternion);
  if (t === 1) r.camera.up.copy(end.up);
  r.frustum = THREE.MathUtils.lerp(start.frustum, end.frustum, t);
  r.camera.zoom = THREE.MathUtils.lerp(start.zoom, end.zoom, t);
  projection(r);
}
function moveCamera(r: Runtime, preset: Preset, reset = false) {
  r.stop();
  const start = cameraState(r);
  cameraPose(r, preset, false);
  const end = cameraState(r);
  if (!reset) end.zoom = start.zoom;
  if (reducedMotion()) { applyCamera(r, end); r.controls.update(); r.render(); return; }
  applyCamera(r, start); r.render();
  const began = performance.now();
  const animate = (now: number) => {
    const t = Math.min(1, (now - began) / 700), ease = t * t * (3 - 2 * t);
    interpolateCamera(r, start, end, ease); r.render();
    if (t < 1) r.frame = requestAnimationFrame(animate);
    else { r.frame = 0; r.controls.update(); }
  };
  r.frame = requestAnimationFrame(animate);
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
    const labelHost = overlay.current;
    if (!element) return;
    // A runtime owns this entire overlay, including any nodes left by an older runtime.
    labelHost?.replaceChildren();
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setFallback(true); latest.current.onError?.('webgl'); return; }
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
    const r: Runtime = { scene, camera, renderer, controls, floor, content, raised, labels: [], bounds: new THREE.Box3(new THREE.Vector3(-100,-100,0), new THREE.Vector3(100,100,100)), width: 1, height: 1, frustum: 500, frame: 0, progress: 1, preset: 'oblique', floorReady: false, modelReady: false, ready: false, render: () => {}, stop: () => {}, begin: () => {} };
    r.render = () => {
      renderer.render(scene, camera);
      const hostRect = element.getBoundingClientRect();
      const occupied = [...(element.closest('.potential-scene')?.querySelectorAll('.scene-toolbar,.scene-footer,.scene-selection') ?? [])].map(item => {
        const rect = item.getBoundingClientRect();
        return { x: rect.left - hostRect.left, y: rect.top - hostRect.top, w: rect.width, h: rect.height };
      });
      // Keep net/component badges away from the full voltage axis, not just its tick text.
      const axisPoints = r.labels.filter(label => label.element.classList.contains('axis-tag')).map(label => {
        const p = label.point.clone().project(camera);
        return { x: (p.x + 1) * r.width / 2, y: (1 - p.y) * r.height / 2, w: label.element.offsetWidth || 52 };
      });
      const axisGutter = axisPoints.length ? { left: Math.min(...axisPoints.map(p => p.x - p.w / 2)) - 8, right: Math.max(...axisPoints.map(p => p.x + p.w / 2)) + 32, top: Math.min(...axisPoints.map(p => p.y)) - 16, bottom: Math.max(...axisPoints.map(p => p.y)) + 16 } : null;
      for (const label of [...r.labels].sort((a,b) => b.priority-a.priority)) {
        const p = label.point.clone(); if (label.lifted) p.z *= r.progress;
        p.project(camera);
        const x = (p.x + 1) * r.width / 2, y = (1 - p.y) * r.height / 2;
        const w = label.element.offsetWidth || 52, h = label.element.offsetHeight || 25;
        const rect = { x: x - w / 2, y: label.element.classList.contains('axis-tag') ? y - h / 2 : y - h - 9, w, h };
        const nearAxis = !label.element.classList.contains('axis-tag') && axisGutter && rect.x < axisGutter.right && rect.x + w > axisGutter.left && rect.y < axisGutter.bottom && rect.y + h > axisGutter.top;
        const hidden = nearAxis || p.z < -1 || p.z > 1 || rect.x < 3 || rect.x + w > r.width - 3 || rect.y < 2 || rect.y + h > r.height - 2 || occupied.some(b => rect.x < b.x+b.w+5 && rect.x+w+5 > b.x && rect.y < b.y+b.h+4 && rect.y+h+4 > b.y);
        label.element.style.visibility = hidden ? 'hidden' : 'visible';
        // Projection owns position. Do not feed coordinates into button transform transitions.
        label.element.style.translate = `${rect.x}px ${rect.y}px`;
        if (!hidden) occupied.push(rect);
      }
    };
    r.stop = () => { cancelAnimationFrame(r.frame); r.frame = 0; const entering = r.progress < 1; r.progress = 1; r.raised.scale.z = 1; if (entering) latest.current.onEntered?.(); };
    r.begin = () => {
      if (r.ready || !r.floorReady || !r.modelReady) return;
      r.ready = true;
      cameraPose(r, 'oblique', false); setPreset('oblique');
      const end = cameraState(r), view = latest.current.sourceView;
      if (reducedMotion()) { r.render(); latest.current.onReady?.(); latest.current.onEntered?.(); return; }
      const center = view ? new THREE.Vector3(view.x + view.width / 2, -view.y - view.height / 2, 0) : new THREE.Vector3(end.target.x, end.target.y, 0);
      const distance = end.position.distanceTo(end.target);
      r.controls.target.copy(center); r.camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
      r.camera.up.set(0, 1, 0); r.camera.lookAt(center);
      const size = r.bounds.getSize(new THREE.Vector3());
      r.frustum = view ? Math.max(view.height, view.width / (r.width / r.height)) : Math.max(size.y, size.x / (r.width / r.height)) * 1.18;
      r.progress = 0; r.raised.scale.z = .0001; projection(r);
      const start = cameraState(r);
      r.render(); latest.current.onReady?.();
      const began = performance.now(), duration = latest.current.entryDuration ?? 1100;
      const animate = (now: number) => {
        const t = Math.min(1, (now - began) / duration), ease = t * t * (3 - 2 * t);
        r.progress = ease; r.raised.scale.z = Math.max(.0001, ease);
        interpolateCamera(r, start, end, ease); r.render();
        if (t < 1) r.frame = requestAnimationFrame(animate);
        else { r.frame = 0; r.controls.update(); latest.current.onEntered?.(); }
      };
      r.frame = requestAnimationFrame(animate);
    };
    runtime.current = r;
    const resize = () => { r.width = Math.max(1, element.clientWidth); r.height = Math.max(1, element.clientHeight); renderer.setSize(r.width, r.height, false); projection(r); r.render(); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    controls.addEventListener('change', r.render);
    const interrupt = () => { r.stop(); r.render(); };
    controls.addEventListener('start', interrupt);
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
    const lost = (event: Event) => { event.preventDefault(); r.stop(); controls.enabled = false; setFallback(true); latest.current.onError?.('context-lost'); };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      cancelAnimationFrame(r.frame); observer.disconnect(); controls.removeEventListener('change',r.render); controls.removeEventListener('start',interrupt); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown',down); renderer.domElement.removeEventListener('pointerup',up); renderer.domElement.removeEventListener('webglcontextlost',lost);
      dispose(r.floor); dispose(r.content); renderer.dispose(); renderer.domElement.remove();
      labelHost?.replaceChildren(); r.labels = []; runtime.current = null;
    };
  }, []);

  // Regenerate a transparent schematic from the document and the same shared symbols as 2D/export.
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    let cancelled = false;
    r.floorReady = false;
    const schematic = { ...circuit, components: circuit.components.map(c => ({ ...c, properties: { ...c.properties, showVoltage: false, showCurrent: false } })) };
    const svg = exportSvg(schematic, { background: 'transparent', monochrome: true, circuitOnly: true, margin: 55 });
    const root = new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
    const [x,y,width,height] = root.getAttribute('viewBox')!.split(' ').map(Number);
    // Rasterize the vector source at the texture's actual pixel size, not its CSS size.
    const maxSide = Math.min(4096, r.renderer.capabilities.maxTextureSize);
    const resolution = Math.min(4, maxSide / Math.max(width, height), Math.sqrt(8_000_000 / (width * height)));
    const pixelWidth = Math.max(1, Math.floor(width * resolution)), pixelHeight = Math.max(1, Math.floor(height * resolution));
    root.setAttribute('width', String(pixelWidth)); root.setAttribute('height', String(pixelHeight));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type:'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url); if (cancelled) return;
      try {
      const canvas = window.document.createElement('canvas');
      canvas.width = pixelWidth; canvas.height = pixelHeight;
      const context = canvas.getContext('2d'); if (!context) { latest.current.onError?.('texture'); return; }
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(16, r.renderer.capabilities.getMaxAnisotropy());
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
      const material = new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.66,side:THREE.DoubleSide,depthWrite:false});
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
      mesh.position.set(x+width/2,-y-height/2,-.25);
      dispose(r.floor); r.floor.clear(); r.floor.add(mesh); r.floorReady = true; r.begin(); r.render();
      } catch { latest.current.onError?.('texture'); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); if (!cancelled) latest.current.onError?.('texture'); };
    // DOM labels and the SVG image use the same bundled mathematics font.
    const fonts = window.document.fonts;
    const fontReady = fonts ? fonts.load('18px "Libertinus Math"') : Promise.resolve([]);
    fontReady.then(() => { if (!cancelled) image.src = url; }).catch(() => { if (!cancelled) latest.current.onError?.('font'); });
    return () => { cancelled = true; image.onload = null; image.onerror = null; URL.revokeObjectURL(url); };
  }, [circuit]);

  useEffect(() => {
    const r = runtime.current, labelHost = overlay.current; if (!r || !labelHost) return;
    r.stop(); r.scene.remove(r.content); dispose(r.content);
    r.content = new THREE.Group(); r.raised = new THREE.Group(); r.content.add(r.raised); r.scene.add(r.content);
    // Preserve DOM identity (including keyboard focus) across scale and display changes.
    // Recreating buttons makes the browser animate their first position from the origin.
    const existingLabels = new Map(r.labels.map(label => [label.key, label]));
    const nextLabels: Label[] = [];
    const extent = sceneExtent(circuit,potential), f = extent.floor;
    r.bounds.set(new THREE.Vector3(f.x-45,-f.y-f.height,extent.minZ-15),new THREE.Vector3(f.x+f.width,-f.y,extent.maxZ+30));
    const radius = Math.max(.9, Math.max(f.width,f.height)*.0035);
    const addLabel = (key: string, text: string, p: THREE.Vector3, className: string, lifted = false, priority = 1, id?: string) => {
      const previous = existingLabels.get(key);
      const tag = id ? 'button' : 'span';
      const reusable = previous?.element.localName === tag ? previous : undefined;
      const element = reusable?.element ?? window.document.createElement(tag);
      if (!reusable) {
        previous?.element.remove();
        element.className = `potential-tag ${className}`;
        element.dataset.labelKey = key;
        element.style.visibility = 'hidden'; // Only reveal after its first projection.
        if(className==='component-tag') element.classList.add('notation');
        labelHost.appendChild(element);
      }
      if (!reusable || reusable.text !== text) {
        if(className==='component-tag'){element.setAttribute('aria-label',text);element.innerHTML=htmlNotation(text,true);}else element.textContent=text;
      }
      if (id) { element.setAttribute('type','button'); element.setAttribute('aria-label',`${text} 선택`); element.onclick = () => latest.current.onSelect?.(id); }
      existingLabels.delete(key);
      nextLabels.push({key,text,element,point:p,lifted,priority});
    };
    // A sparse, transparent reference grid leaves negative voltages visible below it.
    const gridStep = Math.max(f.width,f.height)/12;
    for (let i=0;i<=12;i++) {
      const x=f.x+i*gridStep, y=f.y+i*gridStep;
      if(x<=f.x+f.width) line(r.content,[new THREE.Vector3(x,-f.y,0),new THREE.Vector3(x,-f.y-f.height,0)],'#deded5',false,.45);
      if(y<=f.y+f.height) line(r.content,[new THREE.Vector3(f.x,-y,0),new THREE.Vector3(f.x+f.width,-y,0)],'#deded5',false,.45);
    }
    const axisX=f.x-10, axisY=-f.y-f.height+20;
    line(r.content,[new THREE.Vector3(axisX,axisY,extent.minZ),new THREE.Vector3(axisX,axisY,extent.maxZ+15)],'#8a9384');
    for (const v of extent.ticks) {
      const z=v*potential.scale;
      line(r.content,[new THREE.Vector3(axisX-5,axisY,z),new THREE.Vector3(axisX+7,axisY,z)],v===0?'#53694b':'#a0a99b');
      addLabel(`axis:${v}`,formatQuantity(v,'V'),new THREE.Vector3(axisX-20,axisY,z),'axis-tag',false,v===0?6:5);
      if(guides && v!==0) line(r.content,[new THREE.Vector3(axisX+7,axisY,z),new THREE.Vector3(f.x+f.width,axisY,z)],'#c3c9be',true,.34);
    }
    for (const segment of potential.segments) {
      const active = selectedIds.includes(segment.id) || highlightedId===segment.id || Boolean(selectedNet && potential.nets[selectedNet]?.wireIds.includes(segment.id));
      const color = active ? '#53694b' : showColors ? segment.color : '#667060';
      segment.points.slice(1).forEach((p,i) => tube(r.raised,point(segment.points[i]),point(p),color,radius*(active?1.65:1),segment.id));
    }
    for (const anchor of sceneAnchors(circuit,potential)) {
      const net = potential.nets[anchor.id];
      const owner = net.wireIds[0] ?? circuit.components.find(c=>c.terminals.some(t=>net.endpointIds.includes(t.id)))?.id;
      const pos = point(anchor);
      if (guides && anchor.z!==0) line(r.raised,[new THREE.Vector3(pos.x,pos.y,0),pos],'#929d88',true,.65);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(radius*2,12,8),new THREE.MeshBasicMaterial({color:showColors?anchor.color:'#667060'}));
      dot.position.copy(pos); if(owner) dot.userData.id=owner; r.raised.add(dot);
      if(showNumbers) addLabel(`net:${anchor.id}`,formatQuantity(anchor.voltage,'V'),pos,'net-tag',true,3,owner);
    }
    // All terminals remain visible, including the two disconnected ends of an open switch.
    for (const c of circuit.components) for (let i=0;i<c.terminals.length;i++) {
      const net=potential.endpoints[c.terminals[i].id], p=terminalPosition(c,i);
      if(net?.height===undefined) continue;
      const dot=new THREE.Mesh(new THREE.SphereGeometry(radius*1.3,8,6),new THREE.MeshBasicMaterial({color:showColors?net.color:'#667060'}));
      dot.position.copy(point({...p,z:net.height})); dot.userData.id=c.id; r.raised.add(dot);
    }
    for (const c of circuit.components) {
      const ends = c.terminals.slice(0,2).map(t=>potential.endpoints[t.id]?.height);
      const z = ends.length===2 && ends.every(v=>v!==undefined) ? (ends[0]!+ends[1]!)/2 : 0;
      addLabel(`component:${c.id}`,c.label,point({...c.position,z}),'component-tag',true,2,c.id);
    }
    const selected = selectedVoltage(circuit,potential,selectedIds[0]);
    if(selected) {
      const a=point(selected.a),b=point(selected.b);
      if(guides) for(const p of [a,b]) line(r.raised,[new THREE.Vector3(p.x,p.y,0),p],'#53694b',true,.85);
      const x=(a.x+b.x)/2+20,y=(a.y+b.y)/2+20;
      line(r.raised,[new THREE.Vector3(x,y,a.z),new THREE.Vector3(x,y,b.z)],'#53694b');
      for(const z of [a.z,b.z]) line(r.raised,[new THREE.Vector3(x-5,y,z),new THREE.Vector3(x+5,y,z)],'#53694b');
      if(showNumbers) addLabel(`delta:${selected.component.id}`,`ΔV ${formatQuantity(selected.difference,'V')}`,new THREE.Vector3(x,y,(a.z+b.z)/2),'delta-tag',true,8);
    }
    for (const label of existingLabels.values()) label.element.remove();
    r.labels = nextLabels;
    r.modelReady = true;
    if (!r.ready) r.begin(); else r.render();
  }, [circuit,potential,selectedIds,highlightedId,selectedNet,showNumbers,showColors,guides]);

  const choose = (value: Preset, reset = false) => { const r=runtime.current; if(r?.ready) {moveCamera(r,value,reset);setPreset(value);} };
  return <section className="potential-scene" aria-label="3D 전위 높이 보기">
    <header className="potential-scene-header"><div className="scene-toolbar" aria-label="3D 카메라 보기">
      <button aria-pressed={preset==='oblique'} onClick={()=>choose('oblique')}><MoveUpRight size={14}/>사선</button><button aria-pressed={preset==='front'} onClick={()=>choose('front')}><ScanLine size={14}/>정면</button><button aria-pressed={preset==='top'} onClick={()=>choose('top')}><Layers3 size={14}/>위에서</button><span className="scene-divider"/><button aria-label="높이 안내선" aria-pressed={guides} onClick={()=>setGuides(!guides)}>{guides?<Eye size={15}/>:<EyeOff size={15}/>}</button><button aria-label="보기 초기화" onClick={()=>choose('oblique',true)}><RotateCcw size={14}/></button>
    </div></header>
    <div className="potential-stage"><div className="potential-webgl" ref={host}/><div className="potential-labels" ref={overlay}/>
      {fallback&&<div className="scene-fallback" role="status"><strong>이 기기에서 3D를 표시할 수 없습니다.</strong><p>2D 전위와 경로 그래프에서 같은 값을 확인할 수 있습니다.</p></div>}
    </div>
    <footer className="scene-footer"><span className="floor-key"><i/>기준면 <b>0 V</b><small className="notation" aria-label={referenceLabel} dangerouslySetInnerHTML={{ __html: htmlNotation(referenceLabel.replace(/\s*·\s*0 V$/, ''), true) }}/></span><span className="height-key">높이 <b>×{Number((potential.scale/18).toFixed(2))}</b></span>{potential.undefinedCount>0&&<span>전위 미정 {potential.undefinedCount}개</span>}</footer>
    {selection&&<div className="scene-selection" aria-live="polite"><strong className="notation" aria-label={selection.component.label} dangerouslySetInnerHTML={{__html:htmlNotation(selection.component.label,true)}}/><span>{formatQuantity(selection.a.voltage,'V')} <span aria-hidden="true">→</span> {formatQuantity(selection.b.voltage,'V')}</span><b>양단 전압 {formatQuantity(selection.difference,'V')}</b><small>단자 순서 기준 · 경사는 양단 전위 차이의 도식입니다.</small></div>}
  </section>;
}
