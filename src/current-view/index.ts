import * as q from '../rational';
import type { Point } from '../domain';
import {
  currentBand,
  buildCurrentTracks,
  currentSpacing,
  flowLength,
  flowMarks,
  flowSpeed,
  flowJunctionOpacity,
  flowJunctionRadius,
  type CurrentDisplay,
  type CurrentTrack,
  type ProjectedCurrentPath,
  type FlowViewport,
} from '../visualization';
import './styles.css';
import { createMarkVisibility } from './mark-visibility';

export type { ProjectedCurrentPath } from '../visualization';
export interface CurrentOverlay {
  update(
    paths: ProjectedCurrentPath[],
    viewport: FlowViewport,
    display: CurrentDisplay,
    active?: boolean,
  ): void;
  dispose(): void;
}
const ns = 'http://www.w3.org/2000/svg';
interface Train {
  metric: Point[];
  spacing: number;
  phase: number;
  group: SVGGElement;
  marks: SVGCircleElement[];
}
interface TrackView {
  track: CurrentTrack;
  distances: number[];
  train: Train;
  retiring?: Train;
  pending: number | null;
  blendStart: number | null;
}
const samePoints = (a: Point[], b: Point[]) =>
  a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
function cumulativeLengths(points: Point[]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(
      distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  return distances;
}

/** Shared retained SVG renderer. During reprojection, a train keeps its reference
 * segment/t addresses instead of reseeding dots in the changing screen geometry.
 * Once the view settles, a short crossfade restores uniform screen-space spacing.
 */
export function createCurrentOverlay(host: HTMLElement): CurrentOverlay {
  const doc = host.ownerDocument,
    svg = doc.createElementNS(ns, 'svg');
  svg.classList.add('current-flow-overlay');
  svg.setAttribute('aria-hidden', 'true');
  host.append(svg);
  const bands = doc.createElementNS(ns, 'g'),
    marks = doc.createElementNS(ns, 'g'),
    junctions = doc.createElementNS(ns, 'g');
  svg.append(bands, marks, junctions);
  const bandViews = new Map<string, { group: SVGGElement; line: SVGPolylineElement }>(),
    junctionViews = new Map<string, SVGCircleElement>(),
    tracks = new Map<string, TrackView>();
  let viewport: FlowViewport = { width: 1, height: 1 },
    display: CurrentDisplay | null = null,
    active = true,
    disposed = false;
  let frame = 0,
    previous: number | null = null;
  let currentSignature: string | null = null;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  function spacing(track: CurrentTrack) {
    const desired = currentSpacing(track.amperes, display!.scaleAmperes),
      length = flowLength(track.points);
    return track.closed && Number.isFinite(desired)
      ? length / Math.max(1, Math.round(length / desired))
      : desired;
  }
  function train(track: CurrentTrack, phase = 0): Train {
    const group = doc.createElementNS(ns, 'g');
    group.dataset.flowTrack = track.ids.join(' ');
    marks.append(group);
    return { metric: track.points, spacing: spacing(track), phase, group, marks: [] };
  }
  function drawTrain(view: TrackView, value: Train) {
    const positions = flowMarks(
      value.metric,
      value.phase,
      viewport,
      value.spacing,
      view.track.points,
    );
    positions.forEach((mark, i) => {
      let node = value.marks[i];
      if (!node) {
        node = doc.createElementNS(ns, 'circle');
        node.setAttribute('r', '2.5');
        node.classList.add('current-flow-mark');
        value.group.append(node);
        value.marks.push(node);
      }
      node.style.display = '';
      const distances = view.distances;
      const distance =
        distances[mark.segment] + mark.t * (distances[mark.segment + 1] - distances[mark.segment]);
      node.style.opacity = String(
        flowJunctionOpacity(
          distance,
          distances[distances.length - 1],
          !!view.track.startJunction,
          !!view.track.endJunction,
        ),
      );
      node.setAttribute('transform', `translate(${mark.x} ${mark.y}) rotate(${mark.angle})`);
    });
    // Retain pooled nodes when a camera movement clips them out of view.
    for (let i = positions.length; i < value.marks.length; i++)
      value.marks[i].style.display = 'none';
  }
  function draw() {
    if (visibility.hidden) return;
    for (const view of tracks.values()) {
      drawTrain(view, view.train);
      if (view.retiring) drawTrain(view, view.retiring);
    }
  }
  function reflow(view: TrackView, now: number) {
    const anchor = flowMarks(
      view.train.metric,
      view.train.phase,
      viewport,
      view.train.spacing,
      view.track.points,
    )[0];
    let phase = 0;
    if (anchor) {
      phase = flowLength(view.track.points.slice(0, anchor.segment + 1));
      const a = view.track.points[anchor.segment],
        b = view.track.points[anchor.segment + 1];
      phase += Math.hypot(b.x - a.x, b.y - a.y) * anchor.t;
    }
    view.retiring?.group.remove();
    view.retiring = view.train;
    view.retiring.group.style.opacity = '1';
    view.train = train(view.track, phase);
    view.train.group.style.opacity = '0';
    view.pending = null;
    view.blendStart = now;
  }
  const canAnimate = () =>
    active && !disposed && !display?.paused && !media.matches && !doc.hidden && !visibility.hidden && tracks.size > 0;
  function tick(now: number) {
    frame = 0;
    if (!canAnimate()) {
      previous = null;
      return;
    }
    const delta =
      previous === null ? 0 : Math.min(0.1, Math.max(0, (now - previous) / 1000)) * flowSpeed;
    previous = now;
    for (const view of tracks.values()) {
      view.train.phase += delta;
      if (view.retiring) view.retiring.phase += delta;
      // Reflow once after interaction, never on every camera frame.
      if (!visibility.suppressed && view.pending !== null && now - view.pending >= 140) reflow(view, now);
      if (view.retiring && view.blendStart !== null) {
        const alpha = Math.min(1, Math.max(0, (now - view.blendStart) / 220));
        view.train.group.style.opacity = String(alpha);
        view.retiring.group.style.opacity = String(1 - alpha);
        if (alpha === 1) {
          view.retiring.group.remove();
          view.retiring = undefined;
          view.blendStart = null;
        }
      }
    }
    draw();
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (!canAnimate()) {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = null;
    } else if (!frame) {
      previous = null;
      frame = requestAnimationFrame(tick);
    }
    svg.dataset.motion = canAnimate() ? 'running' : 'paused';
    draw();
  }
  const visibility = createMarkVisibility(marks, () => {
    for (const view of tracks.values()) {
      view.retiring?.group.remove();
      view.retiring = undefined;
      view.blendStart = null;
      view.pending = null;
      view.train.metric = view.track.points;
      view.train.spacing = spacing(view.track);
      view.train.phase = 0;
      view.train.group.style.opacity = '1';
    }
  }, sync);
  media.addEventListener?.('change', sync);
  doc.addEventListener('visibilitychange', sync);
  return {
    update(paths, size, nextDisplay, visible = true) {
      if (disposed) return;
      viewport = size;
      display = nextDisplay;
      active = visible;
      // Compare electrical data, never projected coordinates or model object identity.
      const signature = JSON.stringify([q.exactText(display.scaleAmperes), paths.map(({ path }) => {
        const value = path.sample.value;
        return [path.id, value.status, value.status === 'known'
          ? [q.exactText(value.amperes), value.from.id, value.to.id] : null];
      }).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
      visibility.update(currentSignature !== null && signature !== currentSignature,
        !!display.changing, currentSignature === null || display.paused || media.matches || !active || doc.hidden);
      currentSignature = signature;
      svg.setAttribute('viewBox', `0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`);
      svg.style.visibility = active ? 'visible' : 'hidden';
      const liveBands = new Set<string>();
      for (const { path, points } of paths) {
        if (points.length < 2 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
          continue;
        const value = path.sample.value;
        if (value.status === 'uncertain' || (value.status === 'known' && q.sign(value.amperes) === 0)) continue;
        liveBands.add(path.id);
        let view = bandViews.get(path.id);
        if (!view) {
          const group = doc.createElementNS(ns, 'g'),
            line = doc.createElementNS(ns, 'polyline');
          group.dataset.currentId = path.id;
          group.append(line);
          bands.append(group);
          view = { group, line };
          bandViews.set(path.id, view);
        }
        const { group, line } = view;
        group.dataset.currentStatus = value.status;
        line.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
        line.style.stroke = '';
        if (value.status !== 'known') {
          line.setAttribute('class', 'current-flow-unknown');
          delete group.dataset.bandState;
          delete group.dataset.amperes;
          continue;
        }
        const magnitude = currentBand(value.amperes, display.scaleAmperes, display.widthScale);
        group.dataset.bandState = magnitude.state;
        group.dataset.amperes = q.exactText(value.amperes);
        line.setAttribute(
          'class',
          magnitude.state === 'overflow' ? 'current-flow-overflow' : 'current-flow-band',
        );
        line.setAttribute('stroke-width', String(magnitude.width));
        if (magnitude.state !== 'overflow' && path.color) line.style.stroke = path.color;
      }
      for (const [id, view] of bandViews)
        if (!liveBands.has(id)) {
          view.group.remove();
          bandViews.delete(id);
        }
      const liveTracks = new Set<string>();
      const liveJunctions = new Set<string>(),
        junctionColors = new Map<string, string>();
      for (const { path } of paths) {
        const value = path.sample.value;
        if (path.sample.kind === 'wire' && path.color && value.status === 'known') {
          junctionColors.set(value.from.id, path.color);
          junctionColors.set(value.to.id, path.color);
        }
      }
      const directions = new Map(paths.map(({ path }) => [path.id,
        path.sample.value.status === 'known' ? q.sign(path.sample.value.amperes) : 0]));
      for (const track of buildCurrentTracks(paths)) {
        const length = flowLength(track.points);
        if (!Number.isFinite(length) || length === 0) continue;
        const key = track.ids.map(id => `${id}:${directions.get(id)}`).join(' ');
        liveTracks.add(key);
        let view = tracks.get(key);
        if (!view || view.train.metric.length !== track.points.length) {
          view?.train.group.remove();
          view?.retiring?.group.remove();
          view = {
            track,
            distances: cumulativeLengths(track.points),
            train: train(track),
            pending: null,
            blendStart: null,
          };
          if (visibility.suppressed) view.train.group.style.opacity = '0';
          tracks.set(key, view);
        } else {
          if (!samePoints(view.track.points, track.points)) {
            view.pending = performance.now();
            view.distances = cumulativeLengths(track.points);
          }
          view.track = track;
        }
        for (const [id, point] of [
          [track.startJunction, track.points[0]],
          [track.endJunction, track.points[track.points.length - 1]],
        ] as const) {
          if (!id || liveJunctions.has(id)) continue;
          liveJunctions.add(id);
          let node = junctionViews.get(id);
          if (!node) {
            node = doc.createElementNS(ns, 'circle');
            node.dataset.flowJunction = id;
            node.setAttribute('r', String(flowJunctionRadius));
            node.setAttribute('fill-opacity', '0.85');
            junctions.append(node);
            junctionViews.set(id, node);
          }
          node.setAttribute('cx', String(point.x));
          node.setAttribute('cy', String(point.y));
          node.setAttribute('fill', junctionColors.get(id) ?? '#273441');
        }
      }
      for (const [id, node] of junctionViews)
        if (!liveJunctions.has(id)) {
          node.remove();
          junctionViews.delete(id);
        }
      for (const [id, view] of tracks)
        if (!liveTracks.has(id)) {
          view.train.group.remove();
          view.retiring?.group.remove();
          tracks.delete(id);
        }
      sync();
    },
    dispose() {
      disposed = true;
      visibility.dispose();
      cancelAnimationFrame(frame);
      media.removeEventListener?.('change', sync);
      doc.removeEventListener('visibilitychange', sync);
      svg.remove();
      bandViews.clear();
      junctionViews.clear();
      tracks.clear();
    },
  };
}
