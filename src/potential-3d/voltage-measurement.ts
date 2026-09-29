import { Vector3, type Camera } from 'three';
import type { Point } from '../domain';
import type { PotentialModel } from '../visualization';

/** App supplies the measured value; the scene only maps the probe positions to net heights. */
export interface VoltageMeasurement {
  red: { point: Point; endpointId: string } | null;
  black: { point: Point; endpointId: string } | null;
  label: string | null;
}

const ns = 'http://www.w3.org/2000/svg';
export function createVoltageMeasurementOverlay(host: HTMLElement) {
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('voltage-measurement-overlay');
  svg.setAttribute('role', 'img');
  svg.innerHTML = `<g data-voltage-ruler>
    <path class="voltage-guide probe-red"/><path class="voltage-guide probe-black"/>
    <path class="voltage-ruler"/>
    <g class="voltage-reading"><rect x="-35" y="-14" width="70" height="28" rx="4"/><text text-anchor="middle" dominant-baseline="central"/></g>
  </g>
  <g data-voltage-probe="red" class="voltage-probe probe-red"><circle r="7"/><path d="M-3 0H3 M0 -3V3"/></g>
  <g data-voltage-probe="black" class="voltage-probe probe-black"><circle r="7"/><path d="M-3 0H3"/></g>`;
  host.appendChild(svg);
  const ruler = svg.querySelector<SVGGElement>('[data-voltage-ruler]')!;
  const guides = svg.querySelectorAll<SVGPathElement>('.voltage-guide');
  const dimension = svg.querySelector<SVGPathElement>('.voltage-ruler')!;
  const reading = svg.querySelector<SVGGElement>('.voltage-reading')!;
  const value = reading.querySelector('text')!;
  const badge = reading.querySelector('rect')!;
  const markers = [...svg.querySelectorAll<SVGGElement>('[data-voltage-probe]')];
  return {
    update(
      measurement: VoltageMeasurement | undefined,
      potential: PotentialModel,
      camera: Camera,
      width: number,
      height: number,
      progress: number,
    ) {
      svg.style.display = measurement ? '' : 'none';
      if (!measurement) return;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute(
        'aria-label',
        `전압 탐침${measurement.label ? ` · ${measurement.label}` : ''}`,
      );
      const project = (p: Vector3) => {
        const projected = p.clone().project(camera);
        return {
          x: ((projected.x + 1) * width) / 2,
          y: ((1 - projected.y) * height) / 2,
          visible: projected.z >= -1 && projected.z <= 1,
        };
      };
      const points = [measurement.red, measurement.black].map((probe) => {
        const z = probe ? potential.endpoints[probe.endpointId]?.height : undefined;
        return probe && z !== undefined
          ? new Vector3(probe.point.x, -probe.point.y, z * progress)
          : null;
      });
      const screen = points.map((p) => p && project(p));
      markers.forEach((marker, i) => {
        const p = screen[i];
        marker.style.display = p?.visible ? '' : 'none';
        if (p) marker.setAttribute('transform', `translate(${p.x},${p.y})`);
      });
      // Concentric rings keep two probes on exactly the same point recognizable.
      markers[0]
        .querySelector('circle')!
        .setAttribute(
          'r',
          screen[0] &&
            screen[1] &&
            Math.hypot(screen[0].x - screen[1].x, screen[0].y - screen[1].y) < 16
            ? '11'
            : '7',
        );
      const [a, b] = points;
      ruler.style.display =
        a && b && measurement.label !== null && screen.every((p) => p?.visible) ? '' : 'none';
      if (!a || !b || measurement.label === null) return;
      // Both ends have the same x/y: the ruler measures height, never diagonal distance.
      const x = (a.x + b.x) / 2,
        y = (a.y + b.y) / 2 - 38;
      const ends = [project(new Vector3(x, y, a.z)), project(new Vector3(x, y, b.z))];
      ends.forEach((end, i) => {
        const p = screen[i]!;
        guides[i].setAttribute('d', `M${p.x} ${p.y}L${end.x} ${end.y}`);
      });
      const [u, v] = ends;
      const dx = v.x - u.x,
        dy = v.y - u.y,
        length = Math.hypot(dx, dy);
      const tx = length > 1 ? (-dy / length) * 5 : 5,
        ty = length > 1 ? (dx / length) * 5 : 0;
      dimension.setAttribute(
        'd',
        `M${u.x} ${u.y}L${v.x} ${v.y} M${u.x - tx} ${u.y - ty}L${u.x + tx} ${u.y + ty} M${v.x - tx} ${v.y - ty}L${v.x + tx} ${v.y + ty}`,
      );
      const labelWidth = Math.max(58, measurement.label.length * 9 + 20);
      badge.setAttribute('x', String(-labelWidth / 2));
      badge.setAttribute('width', String(labelWidth));
      value.textContent = measurement.label;
      const middleX = (u.x + v.x) / 2,
        middleY = (u.y + v.y) / 2;
      const offset = labelWidth / 2 + 10;
      const candidates = [
        { x: middleX + offset, y: middleY },
        { x: middleX - offset, y: middleY },
        { x: middleX + offset, y: Math.min(u.y, v.y) - 30 },
      ];
      const position =
        candidates.find(
          (p) =>
            p.x - labelWidth / 2 >= 4 &&
            p.x + labelWidth / 2 <= width - 4 &&
            p.y >= 18 &&
            p.y <= height - 18 &&
            screen.every(
              (probe) =>
                !probe ||
                Math.abs(p.x - probe.x) > labelWidth / 2 + 14 ||
                Math.abs(p.y - probe.y) > 28,
            ),
        ) ?? candidates[0];
      reading.setAttribute('transform', `translate(${position.x},${position.y})`);
    },
    dispose() {
      svg.remove();
    },
  };
}
