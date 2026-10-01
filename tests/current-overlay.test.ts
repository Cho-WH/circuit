// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCurrentOverlay,
  type CurrentOverlay,
  type ProjectedCurrentPath,
} from '../src/current-view';
import type { CurrentDisplay } from '../src/visualization';

let host: HTMLDivElement,
  overlay: CurrentOverlay,
  frames: Map<number, FrameRequestCallback>,
  id: number,
  media: MediaQueryList;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  frames = new Map();
  id = 0;
  media = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList;
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  overlay = createCurrentOverlay(host);
});
afterEach(() => {
  overlay.dispose();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const display: CurrentDisplay = {
  model: { samples: [], maxMagnitude: 3 },
  scaleAmperes: 3,
  widthScale: 1,
  paused: false,
};
function path(amperes = 1): ProjectedCurrentPath {
  return {
    path: {
      id: 'wire',
      sample: {
        id: 'wire',
        kind: 'wire',
        value: {
          status: 'known',
          amperes,
          from: { kind: 'junction', id: 'a' },
          to: { kind: 'junction', id: 'b' },
        },
      },
      points: [],
    },
    points: [
      { x: 20, y: 20 },
      { x: 400, y: 20 },
    ],
  };
}
function step(time: number) {
  const [id, cb] = [...frames][0];
  frames.delete(id);
  cb(time);
}
const size = { width: 500, height: 200 };
function fork(): ProjectedCurrentPath[] {
  return [
    ['input', 'a', 'j', 3, 20, 100, 20],
    ['output1', 'j', 'b', 1, 100, 400, 20],
    ['output2', 'j', 'c', 2, 100, 400, 120],
  ].map(([id, from, to, amperes, x1, x2, y2]) => {
    const result = path(Number(amperes));
    result.path.id = String(id);
    result.path.color = '#ff2300';
    if (result.path.sample.value.status === 'known') {
      result.path.sample.value.from.id = String(from);
      result.path.sample.value.to.id = String(to);
    }
    result.points = [
      { x: Number(x1), y: 20 },
      { x: Number(x2), y: Number(y2) },
    ];
    return result;
  });
}
describe('current overlay ownership and motion', () => {
  it('fades without shifting any dot, then restores the latest spacing only after settling', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    overlay.update([path(1)], size, display); step(0); step(100);
    const train = host.querySelector('[data-flow-track]')!;
    const mark = train.querySelector('circle')!;
    const layer = host.querySelector<SVGGElement>('[data-flow-marks]')!;
    const positions = () => [...train.querySelectorAll('circle')].filter(n => n.style.display !== 'none')
      .map(n => Number(n.getAttribute('transform')!.match(/translate\(([^ ]+)/)![1]));
    const before = positions();
    expect(mark.getAttribute('transform')).toContain('translate(23 20)');
    overlay.update([path(2)], size, display);
    expect(host.querySelector('[data-flow-track]')).toBe(train);
    expect(mark.getAttribute('transform')).toContain('translate(23 20)');
    expect(layer.style.opacity).toBe('0');
    expect(layer.style.transition).toContain('160ms');
    step(116);
    positions().forEach((x, i) => expect(x - before[i]).toBeCloseTo(.48));
    vi.advanceTimersByTime(160);
    expect(frames.size).toBe(0);
    overlay.update([path(1.5)], size, display);
    expect(Number(host.querySelector('.current-flow-band')!.getAttribute('stroke-width'))).toBe(7);
    vi.advanceTimersByTime(299);
    expect(layer.style.opacity).toBe('0');
    vi.advanceTimersByTime(1);
    expect(layer.style.opacity).toBe('1');
    expect(positions()[1] - positions()[0]).toBeCloseTo(68);
    expect(host.querySelector('[data-flow-track]')).toBe(train);
    expect(frames.size).toBe(1);
    // A new change during fade-in suppresses the train again without changing its spacing.
    overlay.update([path(3)], size, display);
    expect(layer.style.opacity).toBe('0');
    expect(positions()[1] - positions()[0]).toBeCloseTo(68);
  });
  it.each([false, true])('keeps dots hidden throughout a held sweep and restores in the latest projection (paused=%s)', paused => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    overlay.update([path()], size, { ...display, paused, changing: true });
    const layer = host.querySelector<SVGGElement>('[data-flow-marks]')!;
    expect(layer.style.opacity).toBe('0');
    vi.advanceTimersByTime(1500); // Includes the automatic sweep's 650ms endpoint dwell.
    expect(layer.style.opacity).toBe('0');
    expect(frames.size).toBe(0);
    const moved = path(2);
    moved.points = [{ x: 40, y: 20 }, { x: 40, y: 180 }];
    overlay.update([moved], size, { ...display, paused, changing: true });
    vi.advanceTimersByTime(1000);
    expect(layer.style.opacity).toBe('0');
    expect(host.querySelector('.current-flow-band')!.getAttribute('points')).toBe('40,20 40,180');
    overlay.update([moved], size, { ...display, paused, changing: false });
    vi.advanceTimersByTime(300);
    expect(layer.style.opacity).toBe('1');
    expect(host.querySelector('.current-flow-mark')!.getAttribute('transform')).toContain('translate(40 20)');
    expect(host.querySelectorAll('.current-flow-mark')[1].getAttribute('transform')).toContain('translate(40 71)');
    expect(frames.size).toBe(paused ? 0 : 1);
    overlay.update([path(1)], size, display);
    overlay.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('fades split/merge endpoints while preserving exact train spacing, phase and speed', () => {
    overlay.update(fork(), size, display);
    const dots = () => [
      ...host.querySelectorAll<SVGCircleElement>('[data-flow-track="output1"] circle'),
    ];
    expect(dots()[0].style.opacity).toBe('0');
    expect(dots()[1].style.opacity).toBe('1');
    expect(dots()[1].getAttribute('transform')).toContain('translate(202 20)');
    const junction = host.querySelector('[data-flow-junction="j"]')!;
    expect(junction.getAttribute('fill')).toBe('#ff2300');
    expect(host.querySelectorAll('[data-flow-junction]')).toHaveLength(1);
    step(0);
    step(100);
    step(200);
    expect(dots()[0].getAttribute('transform')).toContain('translate(106 20)');
    expect(Number(dots()[0].style.opacity)).toBeGreaterThan(0);
    expect(Number(dots()[0].style.opacity)).toBeLessThan(1);
    expect(dots()[1].getAttribute('transform')).toContain('translate(208 20)');
    // Input dot at 74 px is 6 px from the junction: merge-side fading is symmetric.
    const incoming = host.querySelectorAll<SVGCircleElement>('[data-flow-track="input"] circle');
    expect(Number(incoming[2].style.opacity)).toBeCloseTo(Number(dots()[0].style.opacity));
    const allocate = vi.spyOn(document, 'createElementNS');
    const moved = fork().map((p) => ({
      ...p,
      points: p.points.map((q) => ({ x: q.x + 5, y: q.y + 5 })),
    }));
    overlay.update(moved, size, { ...display, paused: true });
    expect(host.querySelector('[data-flow-junction="j"]')).toBe(junction);
    expect(junction.getAttribute('cx')).toBe('105');
    expect(allocate).not.toHaveBeenCalled();
    overlay.update([path(0)], size, display);
    expect(host.querySelector('[data-flow-junction]')).toBeNull();
  });
  it('does not fade an unrelated wire that crosses a junction on screen', () => {
    const unrelated = path();
    unrelated.points = [
      { x: 100, y: 20 },
      { x: 100, y: 190 },
    ];
    if (unrelated.path.sample.value.status === 'known') {
      unrelated.path.sample.value.from.id = 'unrelated-a';
      unrelated.path.sample.value.to.id = 'unrelated-b';
    }
    overlay.update([...fork(), unrelated], size, display);
    expect(
      (host.querySelector('[data-flow-track="wire"] circle') as SVGElement).style.opacity,
    ).toBe('1');
  });
  it('reprojects existing marks by segment position without reallocating SVG nodes during camera motion', () => {
    overlay.update([path()], size, display);
    step(0);
    step(100);
    const dot = host.querySelector('.current-flow-mark')!,
      band = host.querySelector('.current-flow-band');
    const allocate = vi.spyOn(document, 'createElementNS');
    for (let i = 0; i < 20; i++) {
      const next = path();
      next.points = [
        { x: 30 + i, y: 30 },
        { x: 410 + i, y: 130 },
      ];
      overlay.update([next], size, { ...display, paused: true });
      expect(host.querySelector('.current-flow-mark')).toBe(dot);
      expect(host.querySelector('.current-flow-band')).toBe(band);
    }
    const position = dot.getAttribute('transform')!.match(/translate\(([^ ]+) ([^)]+)\)/)!;
    expect(Number(position[1])).toBeCloseTo(52);
    expect(Number(position[2])).toBeCloseTo(30 + (100 * 3) / 380);
    expect(allocate).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it('refits spacing only after the camera settles, fades once, then resumes exact screen speed', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    overlay.update([path()], size, display);
    step(0);
    step(100);
    const projected = path();
    projected.points = [
      { x: 20, y: 20 },
      { x: 400, y: 150 },
    ];
    overlay.update([projected], size, display);
    step(200);
    expect(host.querySelectorAll('[data-flow-track]')).toHaveLength(1);
    step(300);
    expect(host.querySelectorAll('[data-flow-track]')).toHaveLength(2);
    step(400);
    step(500);
    step(600);
    expect(host.querySelectorAll('[data-flow-track]')).toHaveLength(1);
    const position = () =>
      host
        .querySelector('.current-flow-mark')!
        .getAttribute('transform')!
        .match(/translate\(([^ ]+) ([^)]+)\)/)!
        .slice(1)
        .map(Number);
    const a = position();
    step(700);
    const b = position();
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(3, 10);
  });
  it('keeps potential color on the replacement band and returns to neutral when disabled', () => {
    const colored = path();
    colored.path.color = '#ff2300';
    overlay.update([colored], size, display);
    expect((host.querySelector('.current-flow-band') as SVGElement).style.stroke).toBe('#ff2300');
    overlay.update([path()], size, display);
    expect((host.querySelector('.current-flow-band') as SVGElement).style.stroke).toBe('');
  });
  it('varies density with current while preserving speed, reverses only direction, and preserves zero', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    overlay.update([path(1)], size, display);
    const first = host.querySelector('.current-flow-mark')!.getAttribute('transform'),
      count = host.querySelectorAll('.current-flow-mark').length;
    overlay.update([path(2)], size, display);
    vi.advanceTimersByTime(300);
    expect(host.querySelectorAll('.current-flow-mark').length).toBeGreaterThan(count);
    expect(host.querySelector('.current-flow-mark')!.getAttribute('transform')).toBe(first);
    overlay.update([path(-2)], size, display);
    vi.advanceTimersByTime(300);
    expect(host.querySelector('.current-flow-mark')!.getAttribute('transform')).toContain(
      'rotate(180)',
    );
    overlay.update([path(0)], size, display);
    expect(host.querySelector('.current-flow-mark')).toBeNull();
    expect(frames.size).toBe(0);
  });
  it('pauses without losing direction/width and cleans up every pending frame on dispose', () => {
    overlay.update([path()], size, display);
    step(0);
    step(100);
    expect(host.querySelector('.current-flow-mark')!.getAttribute('transform')).toContain(
      'translate(23 20)',
    );
    overlay.update([path()], size, { ...display, paused: true });
    expect(frames.size).toBe(0);
    expect(host.querySelector('.current-flow-band')).not.toBeNull();
    expect(host.querySelector('.current-flow-mark')).not.toBeNull();
    overlay.update([path()], size, display);
    expect(frames.size).toBe(1);
    overlay.dispose();
    expect(frames.size).toBe(0);
    expect(host.children).toHaveLength(0);
  });
  it('stops on reduced motion, hidden documents, or an inactive view and restarts safely', () => {
    overlay.update([path()], size, display);
    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event('change'));
    expect(frames.size).toBe(0);
    Object.assign(media, { matches: false });
    media.dispatchEvent(new Event('change'));
    expect(frames.size).toBe(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    overlay.update([path()], size, display, false);
    expect(frames.size).toBe(0);
    overlay.update([path()], size, display, true);
    expect(frames.size).toBe(1);
  });
  it('shows indeterminate and overflow states without fabricating a proportional band', () => {
    const unknown = path();
    unknown.path.sample.value = { status: 'undefined', diagnostics: [] };
    overlay.update([unknown], size, display);
    expect(host.querySelector('.current-flow-unknown')).not.toBeNull();
    expect(host.querySelector('.current-flow-mark')).toBeNull();
    overlay.update([path(6)], size, display);
    expect(host.querySelector('.current-flow-band')).toBeNull();
    expect(host.querySelector('[data-band-state="overflow"]')).not.toBeNull();
  });
});
