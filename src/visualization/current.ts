import type {
  CircuitDocument,
  CompileResult,
  Diagnostic,
  EndpointRef,
  SimulationResult,
} from '../domain';
import { probeCurrent } from '../measurement';

/** Signed terminal/edge current; no geometry, carrier velocity, or animation clock. */
export type CurrentValue =
  | { status: 'known'; amperes: number; from: EndpointRef; to: EndpointRef }
  | { status: 'undefined' | 'unavailable'; diagnostics: Diagnostic[] };
export interface CurrentSample {
  id: string;
  kind: 'component' | 'wire';
  value: CurrentValue;
}
export interface CurrentModel {
  samples: CurrentSample[];
  maxMagnitude: number;
}
export interface CurrentDisplay {
  model: CurrentModel;
  /** Automatically normalized to the current result's largest magnitude. */
  scaleAmperes: number;
  widthScale: number;
  paused: boolean;
  /** An ongoing parameter gesture or automatic sweep; independent of flow playback. */
  changing?: boolean;
}
export function buildCurrentModel(
  document: CircuitDocument,
  compilation: CompileResult,
  result: SimulationResult,
): CurrentModel {
  const targets = [
    ...document.components.map(({ id }) => ({ id, kind: 'component' as const })),
    ...document.wires.map(({ id }) => ({ id, kind: 'wire' as const })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const samples = targets.map((target) => {
    const reading = probeCurrent(document, compilation, result, target);
    const value: CurrentValue = reading.ok
      ? { status: 'known', ...reading.value }
      : {
          status: reading.diagnostics.some((d) => d.code === 'WIRE_CURRENT_UNDEFINED')
            ? 'undefined'
            : 'unavailable',
          diagnostics: reading.diagnostics,
        };
    return { ...target, value };
  });
  return {
    samples,
    maxMagnitude: samples.reduce(
      (max, { value }) => (value.status === 'known' ? Math.max(max, Math.abs(value.amperes)) : max),
      0,
    ),
  };
}

export const currentFullWidth = 14;
export type CurrentBand = { state: 'zero' | 'visible' | 'subpixel' | 'overflow'; width: number };
/** Never inflate a tiny nonzero value or silently clamp an overflowing ratio. */
export function currentBand(amperes: number, scaleAmperes: number, widthScale = 1): CurrentBand {
  if (amperes === 0) return { state: 'zero', width: 0 };
  if (!Number.isFinite(amperes) || !Number.isFinite(scaleAmperes) || scaleAmperes <= 0)
    return { state: 'overflow', width: 0 };
  const ratio = Math.abs(amperes) / scaleAmperes;
  if (ratio > 1) return { state: 'overflow', width: 0 };
  const width = ratio * currentFullWidth * widthScale;
  return { state: width < 0.75 ? 'subpixel' : 'visible', width };
}
