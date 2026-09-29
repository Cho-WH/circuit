import { Vector3 } from 'three';

const attractionRange = Math.PI / 15; // Twelve degrees, with a smooth boundary.
const holdRange = Math.PI / 90; // A narrow two-degree detent at exactly horizontal.
const elevationOf = (offset: Vector3) => Math.atan2(offset.z, Math.hypot(offset.x, offset.y));
function attractedElevation(angle: number) {
  const magnitude = Math.abs(angle);
  if (magnitude >= attractionRange) return angle;
  if (magnitude <= holdRange) return 0;
  const t = (magnitude - holdRange) / (attractionRange - holdRange);
  return angle * t * t * (3 - 2 * t);
}

/** Keep uncorrected input separate so small, repeated movements can escape the magnet. */
export function createHorizontalAttraction(initialOffset: Vector3) {
  let displayed = elevationOf(initialOffset);
  let input = displayed;
  if (Math.abs(displayed) > 1e-10 && Math.abs(displayed) < attractionRange) {
    // Invert the mapping once so beginning a drag never jumps; exact horizontal starts at its center.
    let low = -attractionRange, high = attractionRange;
    for (let i = 0; i < 32; i++) {
      const middle = (low + high) / 2;
      if (attractedElevation(middle) < displayed) low = middle;
      else high = middle;
    }
    input = (low + high) / 2;
  }
  return (offset: Vector3) => {
    const incoming = elevationOf(offset);
    input += incoming - displayed;
    displayed = attractedElevation(input);
    const horizontal = Math.hypot(offset.x, offset.y), radius = offset.length();
    if (!horizontal || Math.abs(displayed - incoming) < 1e-10) return false;
    offset.set(offset.x / horizontal * radius * Math.cos(displayed), offset.y / horizontal * radius * Math.cos(displayed), radius * Math.sin(displayed));
    return true;
  };
}
