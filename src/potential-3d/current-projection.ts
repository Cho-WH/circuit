import { Vector3, type Camera } from 'three';
import type { CurrentPath, FlowViewport } from '../visualization';
import type { ProjectedCurrentPath } from '../current-view';

/** Three.js is confined to this adapter. Mark spacing/speed use the resulting
 * CSS-pixel polyline, never the document's x/y or the voltage-height slope.
 */
export function projectCurrentPaths(
  paths: CurrentPath[],
  camera: Camera,
  viewport: FlowViewport,
  progress = 1,
): ProjectedCurrentPath[] {
  return paths
    .map((path) => {
      const projected = path.points.map((p) =>
        new Vector3(p.x, -p.y, p.z * progress).project(camera),
      );
      return {
        path,
        depth: projected.reduce((sum, p) => sum + p.z, 0) / projected.length,
        projected,
      };
    })
    .filter((item) =>
      item.projected.every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.z >= -1 && p.z <= 1,
      ),
    )
    .sort((a, b) => b.depth - a.depth)
    .map(({ path, projected }) => ({
      path,
      points: projected.map((p) => ({
        x: ((p.x + 1) * viewport.width) / 2,
        y: ((1 - p.y) * viewport.height) / 2,
      })),
    }));
}
