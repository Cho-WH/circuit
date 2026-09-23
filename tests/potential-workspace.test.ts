// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CircuitDocument } from '../src/domain';
import type { Potential3DProps } from '../src/potential-3d';
import { PotentialWorkspace } from '../src/app/PotentialWorkspace';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { buildPotentialModel } from '../src/visualization';

const observed = vi.hoisted(() => ({ props: null as Potential3DProps | null }));
vi.mock('../src/potential-3d', () => ({ Potential3D: (props: Potential3DProps) => { observed.props = props; return createElement('div', { 'data-scene': true }, '3D'); } }));
let host: HTMLDivElement, root: Root, circuit: CircuitDocument;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  circuit = JSON.parse(readFileSync('fixtures/FIX-02-series.json', 'utf8')).document;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); observed.props = null;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(active = true, doc = circuit) {
  const compiled = compileCircuit(doc).circuit;
  await act(async () => root.render(createElement(PotentialWorkspace, { active, document: doc, potential: buildPotentialModel(doc, compiled, solveCircuit(compiled)), selectedIds: [], showNumbers: true, showColors: true, referenceLabel: 'V1.n', onReturnTo2D: vi.fn(), children: createElement('button', { 'data-2d': true }, '회로') })));
}
const status = () => host.querySelector('.potential-workspace')!.getAttribute('data-status');
const twoD = () => host.querySelector<HTMLElement>('.potential-workspace-2d')!;
describe('3D workspace resource lifecycle', () => {
  it('retains the actual 2D canvas while resources are delayed and reveals only a completed first render', async () => {
    await render(); const canvas = host.querySelector('[data-2d]');
    expect(status()).toBe('preparing'); expect(twoD().style.visibility).toBe('visible');
    expect(host.textContent).not.toContain('3D를 준비하고 있어요');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.textContent).toContain('3D를 준비하고 있어요');
    await act(async () => observed.props!.onReady!());
    expect(status()).toBe('entering'); expect(twoD().style.visibility).toBe('hidden');
    expect(host.querySelector('[data-2d]')).toBe(canvas);
    await act(async () => observed.props!.onEntered!()); expect(status()).toBe('ready');
  });
  it('ignores readiness arriving after cancellation and disposes the pending scene', async () => {
    await render(); const oldReady = observed.props!.onReady!;
    await render(false); await act(async () => oldReady());
    expect(status()).toBe('2d'); expect(twoD().style.visibility).toBe('visible');
    expect(host.querySelector('[data-scene]')).toBeNull();
  });
  it('replaces stale document preparation and ignores its late completion', async () => {
    await render(); const oldReady = observed.props!.onReady!;
    const changed = { ...circuit, title: '새 회로' }; await render(true, changed);
    await act(async () => oldReady()); expect(status()).toBe('preparing');
    expect(observed.props!.document).toBe(changed); expect(twoD().style.visibility).toBe('visible');
  });
  it('keeps 2D usable after resource failure and makes retry concrete', async () => {
    await render(); await act(async () => observed.props!.onError!('texture'));
    expect(status()).toBe('failed'); expect(host.textContent).toContain('3D를 열지 못했어요'); expect(twoD().style.visibility).toBe('visible');
    expect(host.querySelector('[data-scene]')).toBeNull();
    const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '다시 시도')!;
    await act(async () => retry.click()); expect(status()).toBe('preparing');
    await act(async () => observed.props!.onReady!()); expect(status()).toBe('entering');
  });
  it('ends a resource that never settles with a recoverable failure', async () => {
    await render(); await act(async () => vi.advanceTimersByTime(12000));
    expect(status()).toBe('failed'); expect(twoD().style.visibility).toBe('visible');
  });
  it('uses shorter reentry only for an already prepared document version', async () => {
    await render(); expect(observed.props!.entryDuration).toBe(1100);
    await act(async () => observed.props!.onReady!());
    await render(false); await render(); expect(observed.props!.entryDuration).toBe(900);
    await render(true, { ...circuit }); expect(observed.props!.entryDuration).toBe(1100);
  });
});
