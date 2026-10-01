import * as q from '../rational';
import type { Point } from '../domain';
import type { CurrentPath } from './current-paths';

export interface ProjectedCurrentPath {
  path: CurrentPath;
  points: Point[];
}
export interface CurrentTrack {
  ids: string[];
  points: Point[];
  amperes: q.Scalar;
  closed: boolean;
  startJunction?: string;
  endJunction?: string;
}

/** Join serial edges by electrical endpoint identity, never by overlapping pixels.
 * Branches retain independent current densities. No carrier/charge state is created.
 */
export function buildCurrentTracks(paths: ProjectedCurrentPath[]): CurrentTrack[] {
  const edges = paths
    .flatMap(({ path, points }) => {
      const v = path.sample.value;
      if (
        v.status !== 'known' ||
        (typeof v.amperes === 'number' && !Number.isFinite(v.amperes)) ||
        q.sign(v.amperes) === 0 ||
        points.length < 2
      )
        return [];
      const reverse = q.sign(v.amperes) < 0;
      return [
        {
          id: path.id,
          from: (reverse ? v.to : v.from).id,
          to: (reverse ? v.from : v.to).id,
          amperes: q.abs(v.amperes),
          points: reverse ? [...points].reverse() : points,
        },
      ];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const incoming = new Map<string, number[]>(),
    outgoing = new Map<string, number[]>();
  edges.forEach((e, i) => {
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), i]);
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), i]);
  });
  const isJunction = (id: string) => {
    const inputs = incoming.get(id)?.length ?? 0;
    const outputs = outgoing.get(id)?.length ?? 0;
    return inputs > 0 && outputs > 0 && inputs + outputs > 2;
  };
  const next = edges.map((e) => {
    const candidates = outgoing.get(e.to) ?? [];
    if (incoming.get(e.to)?.length !== 1 || candidates.length !== 1) return -1;
    const candidate = edges[candidates[0]];
    return q.equal(e.amperes, candidate.amperes)
      ? candidates[0]
      : -1;
  });
  const hasPrevious = new Set(next.filter((i) => i >= 0)),
    visited = new Set<number>();
  const tracks: CurrentTrack[] = [];
  function walk(start: number) {
    if (visited.has(start)) return;
    const track: CurrentTrack = {
      ids: [],
      points: [],
      amperes: edges[start].amperes,
      closed: false,
    };
    let i = start,
      end = edges[start].to;
    while (i >= 0 && !visited.has(i)) {
      visited.add(i);
      const edge = edges[i];
      end = edge.to;
      track.ids.push(edge.id);
      track.points.push(...(track.points.length ? edge.points.slice(1) : edge.points));
      i = next[i];
    }
    track.closed = i === start;
    if (!track.closed) {
      if (isJunction(edges[start].from)) track.startJunction = edges[start].from;
      if (isJunction(end)) track.endJunction = end;
    }
    tracks.push(track);
  }
  edges.forEach((_, i) => {
    if (!hasPrevious.has(i)) walk(i);
  });
  edges.forEach((_, i) => walk(i));
  return tracks;
}
