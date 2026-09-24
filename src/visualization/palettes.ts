// Approved comparison candidates (2026-09-24), ordered from low to high voltage.
// A/C are authored RGB stops; B uses Jet's piecewise RGB ramps with a longer
// blue end. Keep these samples in sync with the accepted design, not a library default.
export type PotentialPaletteId = 'blue-yellow' | 'spectrum' | 'red-yellow';
type RGB = readonly number[];
export interface PotentialPalette {
  readonly id: PotentialPaletteId;
  readonly name: string;
  readonly stops: readonly RGB[];
}
const hexStops = (colors: string[]): readonly RGB[] => Object.freeze(colors.map(hex =>
  Object.freeze([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))),
));
const spectrum = Object.freeze(Array.from({ length: 256 }, (_, i) => {
  const u = i / 255;
  const t = u <= .5 ? .04 + .92 * u : .125 + .75 * u;
  return Object.freeze([3, 2, 1].map(offset => 255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - offset)))));
}));
export const defaultPotentialPalette: PotentialPaletteId = 'spectrum';
export const potentialPalettes: readonly PotentialPalette[] = Object.freeze([
  Object.freeze({ id: 'blue-yellow' as const, name: '파랑 → 노랑', stops: hexStops(['#2234a5', '#065bdc', '#0093d3', '#00bdb6', '#00c44b', '#8cda00', '#f4df00']) }),
  Object.freeze({ id: 'spectrum' as const, name: '전체 스펙트럼', stops: spectrum }),
  Object.freeze({ id: 'red-yellow' as const, name: '검붉은색 → 노랑', stops: hexStops(['#800d26', '#a81530', '#cf202a', '#eb4825', '#fc7d28', '#ffb43a', '#ffd14a', '#ffe45a']) }),
]);
export function potentialPalette(id: PotentialPaletteId = defaultPotentialPalette): PotentialPalette {
  return potentialPalettes.find(palette => palette.id === id) ?? potentialPalettes[1];
}
// Preserve the original public export as the default palette's shared stops.
export const potentialColorStops = spectrum;
export function potentialColor(value: number | undefined, min: number, max: number, palette: PotentialPaletteId = defaultPotentialPalette): string {
  if (value === undefined || !Number.isFinite(value)) return '#9aa5b3';
  const stops = potentialPalette(palette).stops;
  const t = max === min ? .5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const position = t * (stops.length - 1);
  const index = Math.min(Math.floor(position), stops.length - 2);
  const low = stops[index], high = stops[index + 1], blend = position - index;
  return `rgb(${low.map((a, i) => Math.round(a + (high[i] - a) * blend)).join(',')})`;
}
export function potentialGradient(palette: PotentialPaletteId = defaultPotentialPalette): string {
  const { stops } = potentialPalette(palette);
  return `linear-gradient(90deg,${stops.map(rgb => `rgb(${rgb.map(Math.round).join(',')})`).join(',')})`;
}
