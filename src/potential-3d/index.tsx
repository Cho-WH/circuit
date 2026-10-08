import type { Scalar } from '../rational';
import { formatQuantity as formatSIQuantity, quantityFormatFor, defaultQuantityFormat, type QuantityFormatOptions } from '../quantity';
// @refresh reset
// The imperative WebGL runtime must not retain old render closures across code updates.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Layers3, RotateCcw, MoveUpRight, ScanLine, Eye, EyeOff } from 'lucide-react';
import type { CircuitDocument } from '../domain';
import { isChangeoverSwitch, switchTerminals } from '../domain';
import { operatingMarkSvg, potentialAxisValue, buildCurrentPaths, type ComponentOperatingMark, type CurrentDisplay, type PotentialRange, type PotentialModel, type ComponentLabelLayout } from '../visualization';
import { createCurrentOverlay, type CurrentOverlay } from '../current-view';
import { projectCurrentPaths } from './current-projection';
import { createHorizontalAttraction } from './camera-snap';
import { adjustableParameter, componentValue, htmlNotation, terminalPosition, endpointPosition } from '../component-library';
import { beginPrimitives, endPrimitives, line, tube, dot } from './primitives';
import { exportSvg } from '../export';
import { sceneAnchors, sceneExtent, selectedVoltage, obliqueDirection, projectedSize, sceneBounds, automaticHeight, fitPotentialHeight, minorVoltageTicks } from './model';
import { createVoltageMeasurementOverlay, type VoltageMeasurement } from './voltage-measurement';
export type { VoltageMeasurement } from './voltage-measurement';
import './styles.css';
export { voltageTicks, minorVoltageTicks, sceneAnchors, sceneExtent, selectedVoltage, automaticHeight, fitPotentialHeight } from './model';
export { projectCurrentPaths } from './current-projection';

export interface Potential3DProps {
  onComponentLabelLayout?: (layout: ComponentLabelLayout) => void;
  onViewInteraction?: () => void;
  quantityFormat?: QuantityFormatOptions;
  document: CircuitDocument;
  potential: PotentialModel;
  heightMultiplier?: number;
  heightRange?: PotentialRange;
  selectedIds: string[];
  highlightedId?: string | null;
  selectedNet?: string | null;
  showNumbers: boolean;
  showColors: boolean;
  currentDisplay?: CurrentDisplay;
  voltageMeasurement?: VoltageMeasurement;
  operatingMarks?: Record<string, ComponentOperatingMark>;
  operatingStopped?: boolean;
  onSelect?: (id: string | null) => void;
  onSelectNet?: (netId: string) => void;
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
  currentOverlay: CurrentOverlay | null;
  voltageOverlay: ReturnType<typeof createVoltageMeasurementOverlay> | null;
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
  const direction = preset === 'top' ? new THREE.Vector3(0, 0, 1) : preset === 'front' ? new THREE.Vector3(0, -1, 0) : obliqueDirection;
  r.camera.position.copy(center).addScaledVector(direction, distance);
  r.camera.near = .1; r.camera.far = distance * 10;
  r.camera.zoom = 1;
  // At the pole, set the screen orientation explicitly while keeping OrbitControls' Z-up axis.
  if (preset === 'top') r.camera.quaternion.identity();
  else r.camera.lookAt(center);
  r.camera.updateMatrixWorld(true);
  const span = projectedSize(r.bounds, r.camera.matrixWorldInverse);
  r.frustum = Math.max(span.y, span.x / (r.width / Math.max(1, r.height)), 100) * 1.18;
  projection(r); if (notify) { r.controls.update(); r.render(); }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function cameraState(r: Runtime) {
  return { position: r.camera.position.clone(), rotation: r.camera.quaternion.clone(), target: r.controls.target.clone(), frustum: r.frustum, zoom: r.camera.zoom };
}
function applyCamera(r: Runtime, state: ReturnType<typeof cameraState>) {
  r.camera.position.copy(state.position); r.camera.quaternion.copy(state.rotation);
  r.controls.target.copy(state.target); r.frustum = state.frustum; r.camera.zoom = state.zoom; projection(r);
}
// Keep the optical axis aimed at the moving target throughout the orbit.
// Interpolating position and orientation independently makes the scene drift off-center.
function interpolateCamera(r: Runtime, start: ReturnType<typeof cameraState>, end: ReturnType<typeof cameraState>, t: number) {
  r.controls.target.lerpVectors(start.target, end.target, t);
  r.camera.quaternion.slerpQuaternions(start.rotation, end.rotation, t);
  const distance = THREE.MathUtils.lerp(start.position.distanceTo(start.target), end.position.distanceTo(end.target), t);
  r.camera.position.set(0, 0, distance).applyQuaternion(r.camera.quaternion).add(r.controls.target);
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
  const quantityFormat=useMemo(()=>({...props.quantityFormat??defaultQuantityFormat,modelApproximation:props.potential.modelApproximation}),[props.quantityFormat,props.potential.modelApproximation]);
  const formatQuantity=(value:Scalar|undefined,unit:string)=>formatSIQuantity(value,unit,quantityFormat);
  const { document: circuit, selectedIds, highlightedId, selectedNet, showNumbers, showColors, heightMultiplier = 1 } = props;
  const [heightTarget, setHeightTarget] = useState<{ height: number } | null>(null);
  const resetRequested = useRef(false);
  const potential = useMemo(() => heightTarget ? fitPotentialHeight(props.potential, heightTarget.height, heightMultiplier, props.heightRange) : props.potential, [props.potential, heightTarget, heightMultiplier, props.heightRange]);
  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null);
  const currentHost = useRef<HTMLDivElement>(null), voltageHost = useRef<HTMLDivElement>(null);
  const latestPotential = useRef(potential); latestPotential.current = potential;
  const currentPaths = useMemo(() => props.currentDisplay ? buildCurrentPaths(circuit, props.currentDisplay.model, potential, showColors ? Object.fromEntries(Object.entries(potential.endpoints).map(([id,value])=>[id,value.color])) : undefined) : [], [circuit, props.currentDisplay?.model, potential, showColors]);
  const latestCurrentPaths = useRef(currentPaths); latestCurrentPaths.current = currentPaths;
  const runtime = useRef<Runtime | null>(null), latest = useRef(props);
  latest.current = props;
  const [fallback, setFallback] = useState(false);
  const [preset, setPreset] = useState<Preset>('oblique');
  const [guides, setGuides] = useState(true);

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
    const controlSurface = element.parentElement ?? element;
    const controls = new OrbitControls(camera, controlSurface);
    controls.enableDamping = false; controls.screenSpacePanning = true; controls.minZoom = .3; controls.maxZoom = 8;
    const floor = new THREE.Group(), content = new THREE.Group(), raised = new THREE.Group();
    content.add(raised); scene.add(floor, content);
    const r: Runtime = { scene, camera, renderer, controls, floor, content, raised, labels: [], bounds: new THREE.Box3(new THREE.Vector3(-100,-100,0), new THREE.Vector3(100,100,100)), width: 1, height: 1, frustum: 500, frame: 0, progress: 1, preset: 'oblique', floorReady: false, modelReady: false, ready: false, render: () => {}, stop: () => {}, begin: () => {}, currentOverlay: null, voltageOverlay: voltageHost.current ? createVoltageMeasurementOverlay(voltageHost.current) : null };
    r.render = () => {
      renderer.domElement.setAttribute('aria-label', latest.current.voltageMeasurement ? '전위 높이와 전압 탐침. 드래그하여 시점을 바꿀 수 있어요.' : '바닥 회로도와 전위 높이 지도. 도선 또는 부품을 눌러 값을 확인하세요.');
      renderer.render(scene, camera);
      const current = latest.current.currentDisplay;
      if (current && r.currentOverlay) {
        const viewport = { width: r.width, height: r.height };
        r.currentOverlay.update(projectCurrentPaths(latestCurrentPaths.current, camera, viewport, r.progress), viewport, current, r.ready);
      }
      r.voltageOverlay?.update(latest.current.voltageMeasurement, latestPotential.current, camera, r.width, r.height, r.progress);
      const hostRect = element.getBoundingClientRect();
      const labels: ComponentLabelLayout['labels'] = [];
      const symbolAnchors: NonNullable<ComponentLabelLayout['symbolAnchors']> = [];
      const meterIds = new Set(latest.current.document.components.filter(c => c.type === 'ammeter' || c.type === 'voltmeter').map(c => c.id));
      const occupied = [...(element.closest('.potential-scene')?.querySelectorAll('.scene-toolbar,.scene-footer,.voltage-reading,.voltage-probe') ?? [])].map(item => {
        const rect = item.getBoundingClientRect();
        return { x: rect.left - hostRect.left, y: rect.top - hostRect.top, w: rect.width, h: rect.height };
      });
      // Read dimensions before any projected position/visibility writes. Interleaving
      // them can force the browser to recalculate styles for every label while orbiting.
      // Remeasure each frame so font, content and viewport changes remain correct.
      const measuredLabels = [...r.labels].sort((a,b) => b.priority-a.priority).map(label => ({
        label, w: label.element.offsetWidth || 52, h: label.element.offsetHeight || 25,
      }));
      // Keep net/component badges away from the full voltage axis, not just its tick text.
      const axisPoints = measuredLabels.filter(({label}) => label.element.classList.contains('axis-tag')).map(({label,w}) => {
        const p = label.point.clone().project(camera);
        return { axis: label.key.slice(0,label.key.lastIndexOf(':')), x: (p.x + 1) * r.width / 2, y: (1 - p.y) * r.height / 2, w };
      });
      const axisGutters = [...new Set(axisPoints.map(p => p.axis))].map(axis => {
        const points = axisPoints.filter(p => p.axis === axis);
        return { left: Math.min(...points.map(p => p.x - p.w / 2)) - 8, right: Math.max(...points.map(p => p.x + p.w / 2)) + 8, top: Math.min(...points.map(p => p.y)) - 16, bottom: Math.max(...points.map(p => p.y)) + 16 };
      });
      for (const {label,w,h} of measuredLabels) {
        const p = label.point.clone(); if (label.lifted) p.z *= r.progress;
        p.project(camera);
        const x = (p.x + 1) * r.width / 2, y = (1 - p.y) * r.height / 2;
        if (label.key.startsWith('component:') && meterIds.has(label.key.slice(10)) && p.z >= -1 && p.z <= 1) {
          symbolAnchors.push({ componentId: label.key.slice(10), x: hostRect.x + x + 16, y: hostRect.y + y - 16 });
        }
        const rect = { x: x - w / 2, y: label.element.classList.contains('axis-tag') || label.element.classList.contains('operating-tag') ? y - h / 2 : y - h - 9, w, h };
        if (label.key.startsWith('component:') && latest.current.operatingMarks?.[label.key.slice(10)]) rect.y = y - h - 43;
        const nearAxis = !label.element.classList.contains('axis-tag') && axisGutters.some(gutter => rect.x < gutter.right && rect.x + w > gutter.left && rect.y < gutter.bottom && rect.y + h > gutter.top);
        const hidden = nearAxis || p.z < -1 || p.z > 1 || rect.x < 3 || rect.x + w > r.width - 3 || rect.y < 2 || rect.y + h > r.height - 2 || occupied.some(b => rect.x < b.x+b.w+5 && rect.x+w+5 > b.x && rect.y < b.y+b.h+4 && rect.y+h+4 > b.y);
        label.element.style.visibility = hidden ? 'hidden' : 'visible';
        // Projection owns position. Do not feed coordinates into button transform transitions.
        label.element.style.translate = `${rect.x}px ${rect.y}px`;
        if (!hidden) {
          occupied.push(rect);
          if (label.key.startsWith('component:')) labels.push({ componentId: label.key.slice(10), x: hostRect.x + rect.x, y: hostRect.y + rect.y, width: w, height: h });
        }
      }
      latest.current.onComponentLabelLayout?.({ bounds: { x: hostRect.x, y: hostRect.y, width: r.width, height: r.height }, labels, symbolAnchors, obstacles: [
        ...occupied.map(rect => ({ x: hostRect.x + rect.x, y: hostRect.y + rect.y, width: rect.w, height: rect.h })),
        ...axisGutters.map(g => ({ x: hostRect.x + g.left, y: hostRect.y + g.top, width: g.right - g.left, height: g.bottom - g.top })),
      ] });
    };
    r.stop = () => { latest.current.onViewInteraction?.(); cancelAnimationFrame(r.frame); r.frame = 0; const entering = r.progress < 1; r.progress = 1; r.raised.scale.z = 1; if (entering) latest.current.onEntered?.(); };
    r.begin = () => {
      if (r.ready || !r.floorReady || !r.modelReady) return;
      r.ready = true;
      cameraPose(r, 'oblique', false); setPreset('oblique');
      const end = cameraState(r), view = latest.current.sourceView;
      // Always show how the 2D circuit becomes a potential height map (VIS-004).
      // Reduced motion still applies to the separate camera preset controls.
      const center = view ? new THREE.Vector3(view.x + view.width / 2, -view.y - view.height / 2, 0) : new THREE.Vector3(end.target.x, end.target.y, 0);
      const distance = end.position.distanceTo(end.target);
      r.controls.target.copy(center); r.camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
      r.camera.quaternion.identity();
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
    setHeightTarget({ height: automaticHeight(latest.current.document, latest.current.potential, r.width, r.height) });
    let attract: ReturnType<typeof createHorizontalAttraction> | null = null;
    const change = () => {
      if (attract) {
        const offset = camera.position.clone().sub(controls.target);
        if (attract(offset)) {
          camera.position.copy(controls.target).add(offset);
          camera.lookAt(controls.target);
        }
      }
      r.render();
    };
    controls.addEventListener('change', change);
    const interrupt = () => {
      r.stop(); r.render();
      attract = createHorizontalAttraction(camera.position.clone().sub(controls.target));
    };
    const endInteraction = () => { attract = null; };
    controls.addEventListener('start', interrupt);
    controls.addEventListener('end', endInteraction);
    const pointers = new Set<number>();
    let start: { id:number; x: number; y: number; moved:boolean; label:string|null; net:string|null } | null = null;
    const down = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      const target = (event.target as Element).closest('[data-selection-id],[data-selection-net]');
      start=pointers.size===1&&event.button===0?{id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,label:target?.getAttribute('data-selection-id')??null,net:target?.getAttribute('data-selection-net')??null}:null;
    };
    const move = (event:PointerEvent) => {if(start?.id===event.pointerId&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)start.moved=true;};
    const cancel = (event:PointerEvent) => {pointers.delete(event.pointerId);start=null;attract=null;};
    const blur = () => {pointers.clear();start=null;attract=null;};
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (!start || start.id!==event.pointerId || start.moved || pointers.size || Math.hypot(event.clientX-start.x,event.clientY-start.y)>5) { start = null; return; }
      const {label,net}=start;start = null;
      if(net){latest.current.onSelectNet?.(net);return;}
      if(label){latest.current.onSelect?.(label);return;}
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
      const hit = ray.intersectObjects(r.raised.children,true).find(hit => typeof hit.object.userData.netId === 'string' || typeof hit.object.userData.id === 'string');
      if (hit?.object.userData.netId) latest.current.onSelectNet?.(hit.object.userData.netId);
      else if (hit) latest.current.onSelect?.(hit.object.userData.id);
      else {
        const hitPoint = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),0),new THREE.Vector3());
        const candidate = hitPoint ? latest.current.document.components.find(c => Math.hypot(c.position.x-hitPoint.x,c.position.y+hitPoint.y)<40) : undefined;
        latest.current.onSelect?.(candidate?.id ?? null);
      }
    };
    const lost = (event: Event) => { event.preventDefault(); r.stop(); controls.enabled = false; setFallback(true); latest.current.onError?.('context-lost'); };
    controlSurface.addEventListener('pointerdown', down); controlSurface.addEventListener('pointermove', move); controlSurface.addEventListener('pointercancel', cancel); controlSurface.addEventListener('lostpointercapture', cancel); controlSurface.addEventListener('pointerup', up); renderer.domElement.addEventListener('webglcontextlost', lost); window.addEventListener('blur',blur);
    return () => {
      cancelAnimationFrame(r.frame); observer.disconnect(); controls.removeEventListener('change',change); controls.removeEventListener('start',interrupt); controls.removeEventListener('end',endInteraction); controls.dispose();
      controlSurface.removeEventListener('pointerdown',down); controlSurface.removeEventListener('pointermove',move); controlSurface.removeEventListener('pointercancel',cancel); controlSurface.removeEventListener('lostpointercapture',cancel); controlSurface.removeEventListener('pointerup',up); renderer.domElement.removeEventListener('webglcontextlost',lost); window.removeEventListener('blur',blur);
      dispose(r.floor); dispose(r.content); renderer.dispose(); renderer.domElement.remove();
      r.currentOverlay?.dispose(); r.currentOverlay = null; r.voltageOverlay?.dispose();
      labelHost?.replaceChildren(); r.labels = []; runtime.current = null;
    };
  }, []);

  // Adjustable values are shown with their raised component label. Keep the floor
  // texture independent of those values while retaining shared exported symbols.
  const schematicKey = JSON.stringify({ ...circuit, components: circuit.components.map(c => {
    const parameter = adjustableParameter(c);
    return parameter ? { ...c, properties: { ...c.properties, [parameter.property]: parameter.min, [parameter.property + 'Fraction']: '' } } : c;
  }) });
  // Regenerate a transparent schematic from the document and the same shared symbols as 2D/export.
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    let cancelled = false;
    r.floorReady = false;
    const schematic: CircuitDocument = JSON.parse(schematicKey);
    const svg = exportSvg(schematic, { quantityFormat: props.quantityFormat, background: 'transparent', monochrome: true, circuitOnly: true, margin: 55 });
    const root = new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
    const adjustableIds = new Set(schematic.components.filter(c => adjustableParameter(c)).map(c => c.id));
    root.querySelectorAll('[data-output-part="value"]').forEach(node => { if (adjustableIds.has(node.getAttribute('data-output-id')!)) node.remove(); });
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
  }, [schematicKey,props.quantityFormat]);

  useEffect(() => {
    const r = runtime.current, labelHost = overlay.current; if (!r || !labelHost || !heightTarget) return;
    beginPrimitives(r.content); beginPrimitives(r.raised);
    // Preserve DOM identity (including keyboard focus) across scale and display changes.
    // Recreating buttons makes the browser animate their first position from the origin.
    const existingLabels = new Map(r.labels.map(label => [label.key, label]));
    const nextLabels: Label[] = [];
    const extent = sceneExtent(circuit,potential,props.heightRange), f = extent.floor;
    r.bounds.copy(sceneBounds(extent));
    const radius = Math.max(.9, Math.max(f.width,f.height)*.0035);
    const addLabel = (key: string, text: string, p: THREE.Vector3, className: string, lifted = false, priority = 1, id?: string, netId?: string) => {
      if (props.voltageMeasurement) netId = undefined;
      const previous = existingLabels.get(key);
      const tag = id || netId ? 'button' : 'span';
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
      element.removeAttribute('data-selection-id'); element.removeAttribute('data-selection-net');
      if (id || netId) {
        element.setAttribute('type','button');
        element.setAttribute(netId ? 'data-selection-net' : 'data-selection-id', (netId ?? id)!);
        element.setAttribute('aria-label',`${text} ${netId ? '연결된 지점 선택' : '선택'}`);
        element.onclick = e => { if(e.detail===0) {
          if(netId) latest.current.onSelectNet?.(netId);
          else latest.current.onSelect?.(id!);
        } };
      }
      existingLabels.delete(key);
      nextLabels.push({key,text,element,point:p,lifted,priority});
    };
    // A sparse, transparent reference grid leaves negative voltages visible below it.
    const gridStep = Math.max(f.width,f.height)/12;
    for (let i=0;i<=12;i++) {
      const x=f.x+i*gridStep, y=f.y+i*gridStep;
      if(x<=f.x+f.width) line(r.content,[new THREE.Vector3(x,-f.y,0),new THREE.Vector3(x,-f.y-f.height,0)],'#deded5',false,.25);
      if(y<=f.y+f.height) line(r.content,[new THREE.Vector3(f.x,-y,0),new THREE.Vector3(f.x+f.width,-y,0)],'#deded5',false,.25);
    }
    // Two open guide planes sit outside the circuit: rear (+Y) and left (-X).
    const left=f.x-10, rear=-f.y+10, front=-f.y-f.height+20, right=f.x+f.width;
    const axes = [{key:'axis',x:left,y:front,labelX:left-20}, {key:'axis-rear',x:right,y:rear,labelX:right+20}];
    for (const axis of props.operatingStopped ? [] : axes) {
      line(r.content,[new THREE.Vector3(axis.x,axis.y,extent.minZ),new THREE.Vector3(axis.x,axis.y,extent.maxZ+15)],'#7b856f');
      for (const v of extent.ticks) {
        const z=v*potential.scale;
        line(r.content,[new THREE.Vector3(axis.x-5,axis.y,z),new THREE.Vector3(axis.x+5,axis.y,z)],v===0?'#66745a':'#9da78f');
        addLabel(`${axis.key}:${v}`,formatQuantity(potentialAxisValue(potential,v),'V'),new THREE.Vector3(axis.labelX,axis.y,z),'axis-tag',false,v===0?6:5);
      }
    }
    if (guides && !props.operatingStopped) {
      const addGuide = (v:number, minor:boolean) => {
        const z=v*potential.scale;
        const guide=line(r.content,[new THREE.Vector3(left,front,z),new THREE.Vector3(left,rear,z),new THREE.Vector3(right,rear,z)],v===0?'#68765c':'#7e8a72',v!==0,v===0?.9:minor?.6:.8);
        guide.material.depthWrite=false;
        if(guide.material instanceof THREE.LineDashedMaterial) {guide.material.dashSize=minor?3:8;guide.material.gapSize=6;}
        if(minor) for(const axis of axes)
          line(r.content,[new THREE.Vector3(axis.x-3,axis.y,z),new THREE.Vector3(axis.x+3,axis.y,z)],'#7e8a72',false,.7);
      };
      extent.ticks.forEach(v=>addGuide(v,false));
      minorVoltageTicks(extent.ticks).forEach(v=>addGuide(v,true));
    }
    for (const segment of potential.segments) {
      const active = selectedIds.includes(segment.id) || highlightedId===segment.id || Boolean(selectedNet && potential.nets[selectedNet]?.wireIds.includes(segment.id));
      const color = active ? '#53694b' : showColors ? segment.color : '#667060';
      // Transparent meshes retain hit testing while current bands own the visible path.
      segment.points.slice(1).forEach((p,i) => tube(r.raised,point(segment.points[i]),point(p),color,radius*(active?1.65:1),segment.id,!props.currentDisplay));
    }
    if (!props.operatingStopped && circuit.referenceNode && showNumbers) {
      const reference = { id: circuit.referenceNode.id, endpoint: circuit.referenceNode };
      const position = endpointPosition(circuit, reference.endpoint);
      const height = potential.endpoints[reference.endpoint.id]?.height;
      if (height !== undefined) addLabel(`reference:${reference.id}`, '0 V', point({ ...position, z: height }), 'net-tag', true, 7);
    }
    for (const anchor of sceneAnchors(circuit,potential)) {
      const net = potential.nets[anchor.id];
      const pos = point(anchor);
      if (guides && anchor.z!==0) line(r.raised,[new THREE.Vector3(pos.x,pos.y,0),pos],'#929d88',true,.65);
      dot(r.raised, pos, showColors ? anchor.color : '#667060', radius*2, undefined, !props.currentDisplay, net.netId);
      if(showNumbers && (!circuit.referenceNode || potential.endpoints[circuit.referenceNode.id]?.netId !== net.netId)) addLabel(`net:${anchor.id}`,formatQuantity(anchor.voltage,'V'),pos,'net-tag',true,3,undefined,net.netId);
    }
    // All terminals remain visible, including the two disconnected ends of an open switch.
    for (const c of circuit.components) for (let i=0;i<c.terminals.length;i++) {
      const net=potential.endpoints[c.terminals[i].id], p=terminalPosition(c,i);
      if(net?.height===undefined) continue;
      dot(r.raised, point({...p,z:net.height}), showColors ? net.color : '#667060', radius*1.3, undefined, !props.currentDisplay, net.netId);
    }
    for (const c of circuit.components) {
      const ends = (isChangeoverSwitch(c) ? switchTerminals(c) : c.terminals.slice(0,2)).map(t=>t && potential.endpoints[t.id]?.height);
      const z = ends.length===2 && ends.every(v=>v!==undefined) ? (ends[0]!+ends[1]!)/2 : 0;
      addLabel(`component:${c.id}`,adjustableParameter(c) ? `${c.label} = ${componentValue(c, props.quantityFormat ?? defaultQuantityFormat)}` : c.label,point({...c.position,z}),'component-tag',true,2,c.id);
      const mark = props.operatingMarks?.[c.id];
      if (mark) {
        const key = `operating:${c.id}:${mark.event}`;
        addLabel(key,mark.label,point({...c.position,z}),'operating-tag',true,10,c.id);
        const element = nextLabels[nextLabels.length-1].element;
        const signature = `${mark.state}:${mark.event}`;
        if (element.dataset.operatingSignature !== signature) {
          element.innerHTML = `<svg viewBox="-44 -34 88 68" aria-hidden="true" class="component-operating-mark is-${mark.state}">${operatingMarkSvg(mark.state)}</svg>`;
          element.dataset.operatingSignature = signature;
        }
        element.title = mark.label;
      }
    }
    const selected = props.voltageMeasurement ? null : selectedVoltage(circuit,potential,selectedIds[0]);
    if(selected) {
      const a=point(selected.a),b=point(selected.b);
      if(guides) for(const p of [a,b]) line(r.raised,[new THREE.Vector3(p.x,p.y,0),p],'#53694b',true,.85);
      const x=(a.x+b.x)/2+20,y=(a.y+b.y)/2+20;
      line(r.raised,[new THREE.Vector3(x,y,a.z),new THREE.Vector3(x,y,b.z)],'#53694b');
      for(const z of [a.z,b.z]) line(r.raised,[new THREE.Vector3(x-5,y,z),new THREE.Vector3(x+5,y,z)],'#53694b');
      if(showNumbers) addLabel(`delta:${selected.component.id}`,`ΔV ${formatSIQuantity(selected.difference,'V',{...quantityFormatFor(selected.component.properties),modelApproximation:potential.modelApproximation})}`,new THREE.Vector3(x,y,(a.z+b.z)/2),'delta-tag',true,8);
    }
    for (const label of existingLabels.values()) label.element.remove();
    r.labels = nextLabels;
    endPrimitives(r.content); endPrimitives(r.raised);
    r.modelReady = true;
    if (!r.ready) r.begin();
    else if (resetRequested.current) { resetRequested.current = false; moveCamera(r, 'oblique', true); }
    else r.render();
  }, [circuit,potential,selectedIds,highlightedId,selectedNet,showNumbers,showColors,guides,quantityFormat,Boolean(props.currentDisplay),Boolean(props.voltageMeasurement),props.heightRange,props.operatingMarks,props.operatingStopped]);

  useEffect(() => {
    const r = runtime.current;
    if (!r || !props.currentDisplay || !currentHost.current || fallback) return;
    const flow = createCurrentOverlay(currentHost.current);
    r.currentOverlay = flow; r.render();
    return () => { flow.dispose(); if (r.currentOverlay === flow) r.currentOverlay = null; };
  }, [Boolean(props.currentDisplay), fallback]);
  useEffect(() => { runtime.current?.render(); }, [props.currentDisplay, currentPaths]);

  useEffect(() => { runtime.current?.render(); }, [props.voltageMeasurement, potential]);

  const choose = (value: Preset, reset = false) => { const r=runtime.current; if(r?.ready) {
    if (reset) { resetRequested.current = true; setHeightTarget({ height: automaticHeight(circuit, props.potential, r.width, r.height) }); }
    else moveCamera(r,value);
    setPreset(value);
  } };
  return <section className="potential-scene" aria-label="3D 전위 높이 보기">
    <header className="potential-scene-header"><div className="scene-toolbar" aria-label="3D 카메라 보기">
      <button aria-pressed={preset==='oblique'} onClick={()=>choose('oblique')}><MoveUpRight size={14}/>사선</button><button aria-pressed={preset==='front'} onClick={()=>choose('front')}><ScanLine size={14}/>정면</button><button aria-pressed={preset==='top'} onClick={()=>choose('top')}><Layers3 size={14}/>위</button><button aria-label="보기 초기화" onClick={()=>choose('oblique',true)}><RotateCcw size={14}/></button><span className="scene-divider"/><button aria-label="눈금" aria-pressed={guides} onClick={()=>setGuides(!guides)}>{guides?<Eye size={15}/>:<EyeOff size={15}/>}눈금</button>
    </div></header>
    <div className="potential-stage"><div className="potential-webgl" ref={host}/><div className="current-flow-host" ref={currentHost}/><div className="potential-labels" ref={overlay}/><div className="voltage-measurement-host" ref={voltageHost}/>
      {fallback&&<div className="scene-fallback" role="status"><strong>이 기기에서 3D를 표시할 수 없습니다.</strong><p>2D 전위와 경로 그래프에서 같은 값을 확인할 수 있습니다.</p></div>}
    </div>
    <footer className="scene-footer" hidden={props.operatingStopped}><span className="height-key">높이 <b>×{Number(heightMultiplier.toFixed(2))}</b></span>{potential.undefinedCount>0&&<span>전위 미정 {potential.undefinedCount}개</span>}</footer>
  </section>;
}
