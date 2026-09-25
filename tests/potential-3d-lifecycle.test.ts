// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import type { CircuitDocument } from '../src/domain';
import { Potential3D, type Potential3DProps } from '../src/potential-3d';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { buildPotentialModel } from '../src/visualization';

const observed = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn(), start: () => {}, frames: new Map<number, FrameRequestCallback>(), nextFrame: 0, target: null as THREE.Vector3 | null }));
vi.mock('three', async importOriginal => {
  const three = await importOriginal<typeof import('three')>();
  return { ...three, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    capabilities = { maxTextureSize: 4096, getMaxAnisotropy: () => 16 };
    setPixelRatio() {} setClearColor() {} setSize() {}
    render = observed.render; dispose = observed.dispose;
  } };
});
vi.mock('three/addons/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three');
  return { OrbitControls: class {
    target = new Vector3(); enabled = true;
    constructor() { observed.target = this.target; }
    addEventListener(type: string, callback: () => void) { if (type === 'start') observed.start = callback; }
    removeEventListener() {} update() {} dispose() {}
  } };
});
let root: Root, host: HTMLDivElement, resolveFont: () => void, rejectFont: () => void;
let images: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }>;
let reduced = false;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); observed.render.mockClear(); observed.dispose.mockClear(); observed.frames.clear(); reduced = false; images = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++observed.nextFrame; observed.frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => observed.frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.stubGlobal('Image', class { src = ''; onload = null; onerror = null; constructor() { images.push(this); } });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const font = new Promise<FontFace[]>((resolve, reject) => { resolveFont = () => resolve([]); rejectFont = () => reject(new Error('font')); });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => font } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(strict = false) {
  const circuit = JSON.parse(readFileSync('fixtures/FIX-02-series.json', 'utf8')).document as CircuitDocument;
  const compiled = compileCircuit(circuit).circuit, ready = vi.fn(), entered = vi.fn(), error = vi.fn();
  let props: Potential3DProps = { document: circuit, potential: buildPotentialModel(circuit, compiled, solveCircuit(compiled)), selectedIds: [], showNumbers: true, showColors: true, referenceLabel: 'V_1 · −극 단자', sourceView: { x: 100, y: 200, width: 500, height: 400 }, onReady: ready, onEntered: entered, onError: error };
  const update = async (next: Partial<Potential3DProps>) => { props = {...props,...next}; await act(async () => { const scene=createElement(Potential3D, props); root.render(strict?createElement(StrictMode,null,scene):scene); }); };
  await update({});
  return { ready, entered, error, circuit, compiled, update };
}
async function advanceFrame(now: number) {
  const [id, frame] = [...observed.frames.entries()][0];
  observed.frames.delete(id);
  await act(async () => frame(now));
}

describe('3D prepared first frame and camera lifetime', () => {
  it('selects labels only on a single stationary pointer or keyboard activation',async()=>{
    reduced=true;const {update}=await mount(),select=vi.fn();await update({onSelect:select});
    await act(async()=>resolveFont());await act(async()=>images.at(-1)!.onload!());await advanceFrame(performance.now()+2000);
    const label=host.querySelector<HTMLElement>('[data-label-key="component:R1"]')!;
    const pointer=(type:string,id:number,x=100)=>act(()=>label.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:100})));
    pointer('pointerdown',1);pointer('pointerup',1);expect(select).toHaveBeenCalledExactlyOnceWith('R1');select.mockClear();
    pointer('pointerdown',1);pointer('pointermove',1,150);pointer('pointermove',1,100);pointer('pointerup',1);
    pointer('pointerdown',1);pointer('pointerdown',2);pointer('pointerup',2);pointer('pointerup',1);
    pointer('pointerdown',1);pointer('pointercancel',1);pointer('pointerup',1);
    pointer('pointerdown',1);pointer('pointerup',2);pointer('pointerup',1);
    act(()=>label.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1})));
    expect(select).not.toHaveBeenCalled();
    act(()=>label.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:0})));
    expect(select).toHaveBeenCalledExactlyOnceWith('R1');
  });
  it('cleans imperative labels on effect teardown, including StrictMode remounts',async()=>{
    reduced=true;
    const {update}=await mount(true);await act(async()=>resolveFont());await act(async()=>images.at(-1)!.onload!());await advanceFrame(performance.now()+2000);
    const labels=[...host.querySelectorAll<HTMLElement>('[data-label-key]')];
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels.map(e=>e.dataset.labelKey)).size).toBe(labels.length);
    expect(labels.every(e=>e.style.translate.includes('px'))).toBe(true);
    await update({showColors:false});
    expect(host.querySelectorAll('[data-label-key]')).toHaveLength(labels.length);
    await act(async()=>root.render(null));expect(labels.every(e=>!e.isConnected)).toBe(true);
  });
  it('keeps labels and focus while each height change projects directly onto the current scene', async () => {
    reduced=true;
    const {circuit,compiled,update}=await mount();
    await act(async()=>resolveFont());await act(async()=>images[0].onload!());await advanceFrame(performance.now()+2000);
    const nodes=[...host.querySelectorAll<HTMLElement>('[data-label-key]')];
    const label=host.querySelector<HTMLElement>('[data-label-key="component:R1"]')!;
    label.focus();
    const [,camera]=observed.render.mock.lastCall as [THREE.Scene,THREE.OrthographicCamera];
    const cameraPosition=camera.position.clone(),rotation=camera.quaternion.clone(),zero=host.querySelector<HTMLElement>('[data-label-key="axis:0"]')!,zeroPosition=zero.style.translate;
    for(const scale of [19,20,4,40,18]) {
      const potential=buildPotentialModel(circuit,compiled,solveCircuit(compiled),{scale});
      await update({potential});
      expect([...host.querySelectorAll('[data-label-key]')]).toEqual(nodes);
      expect(document.activeElement).toBe(label);
      expect(camera.position.equals(cameraPosition)).toBe(true);expect(camera.quaternion.equals(rotation)).toBe(true);
      const component=circuit.components.find(c=>c.id==='R1')!;
      const height=component.terminals.reduce((n,t)=>n+potential.endpoints[t.id].height!,0)/2;
      const {Vector3}=await import('three');
      const projected=new Vector3(component.position.x,-component.position.y,height).project(camera);
      const [x,y]=label.style.translate.split(' ').map(parseFloat);
      expect(x).toBeCloseTo((projected.x+1)*1000/2-26,8);
      expect(y).toBeCloseTo((1-projected.y)*600/2-25-9,8);
      expect(label.style.transform).toBe('');
      expect(zero.style.translate).toBe(zeroPosition);
      expect(observed.frames.size).toBe(0);
    }
  });
  it('updates surviving labels and removes obsolete ones without replacing unrelated nodes',async()=>{
    reduced=true;
    const {circuit,update}=await mount();await act(async()=>resolveFont());await act(async()=>images[0].onload!());await advanceFrame(performance.now()+2000);
    const component=host.querySelector<HTMLElement>('[data-label-key="component:R1"]')!,nets=[...host.querySelectorAll('.net-tag')];
    await update({selectedIds:['R1'],showColors:false});
    expect(host.querySelector('[data-label-key="component:R1"]')).toBe(component);
    const delta=host.querySelector('[data-label-key="delta:R1"]')!;expect(delta).not.toBeNull();
    await update({selectedIds:['R2'],showNumbers:false});
    expect(delta.isConnected).toBe(false);expect(nets.every(n=>!n.isConnected)).toBe(true);
    expect(host.querySelector('[data-label-key="component:R1"]')).toBe(component);
    const renamed={...circuit,components:circuit.components.map(c=>c.id==='R1'?{...c,label:'R_9'}:c)};
    await update({document:renamed});
    expect(host.querySelector('[data-label-key="component:R1"]')).toBe(component);
    expect(component.querySelector('sub')?.textContent).toBe('9');expect(component.getAttribute('aria-label')).toBe('R_9 선택');
  });
  it('waits for mathematics font and floor texture, then renders aligned top view before announcing ready', async () => {
    const { ready, entered } = await mount();
    expect(images[0].src).toBe(''); expect(ready).not.toHaveBeenCalled();
    await act(async () => resolveFont()); expect(images[0].src).toContain('blob:'); expect(ready).not.toHaveBeenCalled();
    await act(async () => images[0].onload!()); expect(ready).toHaveBeenCalledOnce(); expect(entered).not.toHaveBeenCalled();
    const [scene, camera] = observed.render.mock.lastCall as [THREE.Scene, THREE.OrthographicCamera];
    expect(scene.children[0].children).toHaveLength(1);
    const floor = scene.children[0].children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const texture = floor.material.map!;
    expect(texture.image.width).toBeGreaterThan(floor.geometry.parameters.width * 2);
    expect(texture.image.width).toBeLessThanOrEqual(4096);
    expect(texture.image.width * texture.image.height).toBeLessThanOrEqual(8_000_000);
    expect(texture.anisotropy).toBe(16);
    expect(camera.position.x).toBe(350); expect(camera.position.y).toBe(-400); expect(camera.top - camera.bottom).toBe(400);
    expect(scene.children[1].children[0].scale.z).toBe(.0001);
    expect(observed.frames.size).toBe(1);
    await act(async () => observed.start());
    expect(observed.frames.size).toBe(0); expect(entered).toHaveBeenCalledOnce(); expect(scene.children[1].children[0].scale.z).toBe(1);
    // Interruption preserves the current camera instead of snapping to the preset.
    expect(camera.position.x).toBe(350); expect(camera.position.y).toBe(-400);
  });
  it.each([
    { motion: false, duration: 1100 },
    { motion: true, duration: 1100 },
    { motion: false, duration: 900 },
    { motion: true, duration: 900 },
  ])('animates entry with reduced motion $motion for $duration ms', async ({ motion, duration }) => {
    reduced = motion;
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { ready, entered, update } = await mount();
    await update({ entryDuration: duration });
    await act(async () => resolveFont()); await act(async () => images[0].onload!());
    const [scene, camera] = observed.render.mock.lastCall as [THREE.Scene, THREE.OrthographicCamera];
    const raised = scene.children[1].children[0], initial = camera.position.clone();
    expect(ready).toHaveBeenCalledOnce(); expect(entered).not.toHaveBeenCalled();
    expect(raised.scale.z).toBe(.0001); expect(observed.frames.size).toBe(1);
    expect(camera.position.x).toBe(350); expect(camera.position.y).toBe(-400);
    await advanceFrame(1000 + duration / 2);
    expect(raised.scale.z).toBeCloseTo(.5); expect(camera.position.equals(initial)).toBe(false);
    expect(entered).not.toHaveBeenCalled(); expect(observed.frames.size).toBe(1);
    const midway = camera.position.clone();
    await advanceFrame(1000 + duration);
    expect(raised.scale.z).toBe(1); expect(camera.position.equals(midway)).toBe(false);
    expect(ready).toHaveBeenCalledOnce(); expect(entered).toHaveBeenCalledOnce(); expect(observed.frames.size).toBe(0);
    expect(host.querySelector('.floor-key small sub')?.textContent).toBe('1');
  });
  it('still skips camera preset motion when reduced motion is enabled', async () => {
    reduced = true; const { entered } = await mount();
    await act(async () => resolveFont()); await act(async () => images[0].onload!());
    await advanceFrame(performance.now() + 2000);
    const [, camera] = observed.render.mock.lastCall as [THREE.Scene, THREE.OrthographicCamera];
    const initial = camera.position.clone(); camera.zoom = 2;
    const top = [...host.querySelectorAll('button')].find(button => button.textContent === '위에서')!;
    await act(async () => top.click());
    expect(camera.position.equals(initial)).toBe(false); expect(camera.zoom).toBe(2);
    expect(observed.frames.size).toBe(0); expect(entered).toHaveBeenCalledOnce();
  });
  it('preserves zoom during presets and cancels a camera flight at its current position', async () => {
    const { entered } = await mount(); await act(async () => resolveFont()); await act(async () => images[0].onload!());
    await act(async () => observed.start());
    const [, camera] = observed.render.mock.lastCall as [THREE.Scene, THREE.OrthographicCamera];
    camera.zoom = 2; const initial = camera.position.clone();
    const top = [...host.querySelectorAll('button')].find(button => button.textContent === '위에서')!;
    await act(async () => top.click());
    expect(camera.position.equals(initial)).toBe(true); expect(camera.zoom).toBe(2);
    const [id, frame] = [...observed.frames.entries()][0]; observed.frames.delete(id);
    await act(async () => frame(performance.now() + 350));
    const midway = camera.position.clone();
    const look = camera.getWorldDirection(new (await import('three')).Vector3());
    const targetDirection = observed.target!.clone().sub(camera.position).normalize();
    expect(look.dot(targetDirection)).toBeCloseTo(1, 10);
    await act(async () => observed.start()); expect(observed.frames.size).toBe(0); expect(camera.position.equals(midway)).toBe(true);
    expect(camera.zoom).toBe(2); expect(entered).toHaveBeenCalledOnce();
  });
  it('reports font failure without starting texture loading or announcing readiness', async () => {
    const { ready, error } = await mount(); await act(async () => rejectFont());
    expect(error).toHaveBeenCalledWith('font'); expect(ready).not.toHaveBeenCalled(); expect(images[0].src).toBe('');
  });
  it('reports texture failure and disposes GPU resources when removed', async () => {
    const { ready, error } = await mount(); await act(async () => resolveFont()); await act(async () => images[0].onerror!());
    expect(error).toHaveBeenCalledWith('texture'); expect(ready).not.toHaveBeenCalled();
    await act(async () => root.render(null)); expect(observed.dispose).toHaveBeenCalledOnce(); expect(images[0].onload).toBeNull();
  });
});
