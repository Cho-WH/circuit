import type { ComponentLabelLayout, ScreenRectangle } from '../../visualization';

interface HelpPlacement extends ScreenRectangle {
  iconX: number;
  iconY: number;
}

const overlaps = (a: ScreenRectangle, b: ScreenRectangle) =>
  a.x < b.x + b.width + 3 &&
  a.x + a.width + 3 > b.x &&
  a.y < b.y + b.height + 3 &&
  a.y + a.height + 3 > b.y;
/** Reserve the whole 44px hit target, including other labels and earlier help buttons. */
export function placeOperatingHelp(
  layout: ComponentLabelLayout,
  ids: readonly string[],
  extra: ScreenRectangle[] = [],
) {
  const positions = new Map<string, HelpPlacement>();
  const occupied = [...layout.obstacles, ...layout.labels, ...extra];
  for (const id of ids) {
    const label = layout.labels.find((l) => l.componentId === id);
    if (!label) continue;
    const { bounds: b } = layout;
    if (
      label.x < b.x ||
      label.y < b.y ||
      label.x + label.width > b.x + b.width ||
      label.y + label.height > b.y + b.height
    )
      continue;
    // Put the visible 20px badge against the label; grow its touch area outward/upward.
    // Small upward alternatives avoid a nearby damage mark without a distant badge.
    const beside = label.y + label.height / 2 - 34;
    const candidates = [
      { x: label.x + label.width + 4, y: beside, iconX: 0 },
      { x: label.x + label.width + 4, y: beside - 8, iconX: 0 },
      { x: label.x - 48, y: beside, iconX: 24 },
      { x: label.x - 48, y: beside - 8, iconX: 24 },
      { x: label.x + label.width + 4, y: label.y - 48, iconX: 0 },
      { x: label.x - 48, y: label.y - 48, iconX: 24 },
      { x: label.x + label.width / 2 - 22, y: label.y - 48, iconX: 12 },
    ].map((p) => ({ ...p, width: 44, height: 44, iconY: 24 }));
    const position = candidates.find(
      (p) =>
        p.x >= b.x + 4 &&
        p.y >= b.y + 4 &&
        p.x + 44 <= b.x + b.width - 4 &&
        p.y + 44 <= b.y + b.height - 4 &&
        !occupied.some((o) => overlaps(p, o)),
    );
    if (position) {
      positions.set(id, position);
      occupied.push(position);
    }
  }
  return positions;
}
