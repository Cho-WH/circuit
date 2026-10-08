import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { CircleMinus, CirclePlus } from 'lucide-react';
import type {
  CircuitDocument,
  CompileResult,
  ComponentInstance,
  SimulationResult,
} from '../domain';
import { probeCurrent, probeVoltage } from '../measurement';
import { endpointName } from '../component-library';
import { formatQuantity, quantityFormatFor } from '../quantity';
import type { ComponentLabelLayout, ScreenRectangle } from '../visualization';
import { MeasurementDisplay } from './MeasurementDisplay';
import './meter-readouts.css';

interface Props {
  document: CircuitDocument;
  compilation: CompileResult;
  result: SimulationResult;
  suspended: boolean;
  openIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}
export interface MeterReadoutsHandle {
  updateLayout: (layout: ComponentLabelLayout) => void;
}

const overlaps = (a: ScreenRectangle, b: ScreenRectangle) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Use the same public queries as movable probes, including independent-reference checks. */
export function meterReading(
  component: ComponentInstance,
  props: Pick<Props, 'document' | 'compilation' | 'result' | 'suspended'>,
) {
  const { document, compilation, result, suspended } = props;
  const [a, b] = component.terminals;
  const unit = component.type === 'ammeter' ? 'A' : 'V';
  const reading = suspended
    ? null
    : component.type === 'ammeter'
      ? probeCurrent(document, compilation, result, { kind: 'component', id: component.id })
      : probeVoltage(
          compilation,
          result,
          a ? { kind: 'terminal', id: a.id } : null,
          b ? { kind: 'terminal', id: b.id } : null,
        );
  const value = reading?.ok
    ? 'amperes' in reading.value
      ? reading.value.amperes
      : reading.value.voltageV
    : undefined;
  const direction =
    a && b ? `${endpointName(document, a.id)} → ${endpointName(document, b.id)}` : '';
  return {
    text: formatQuantity(value, unit, {
      ...quantityFormatFor(component.properties),
      modelApproximation: result.provenance?.physicalModel === 'component',
    }),
    direction,
  };
}

/** Reposition on the existing renderer callback; no extra animation loop or per-frame React state. */
export const MeterReadouts = forwardRef<MeterReadoutsHandle, Props>(
  function MeterReadouts(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const layout = useRef<ComponentLabelLayout | null>(null);
    const meters = useMemo(
      () => props.document.components.filter((c) => c.type === 'ammeter' || c.type === 'voltmeter'),
      [props.document],
    );
    function updateLayout(next: ComponentLabelLayout) {
      layout.current = next;
      const root = host.current;
      if (!root || !root.children.length) return;
      const origin = root.getBoundingClientRect();
      // Batch dimension reads before position writes, just like the 3D labels.
      const nodes = [...root.querySelectorAll<HTMLElement>('[data-meter-id]')].map((node) => ({
        node,
        width: node.offsetWidth,
        height: node.offsetHeight,
      }));
      const placed: ScreenRectangle[] = [];
      for (const { node, width, height } of nodes) {
        const anchor = next.symbolAnchors?.find((a) => a.componentId === node.dataset.meterId);
        const b = next.bounds;
        const visible =
          anchor &&
          anchor.x >= b.x &&
          anchor.x <= b.x + b.width &&
          anchor.y >= b.y &&
          anchor.y <= b.y + b.height;
        node.style.visibility = visible ? 'visible' : 'hidden';
        if (!visible) continue;
        const x = Math.max(b.x + 4, Math.min(anchor.x - 12, b.x + b.width - width - 4));
        const baseY = anchor.y - 32;
        const candidates = [0, -24, -48, 24, 48, -96, 96].map((offset) => ({
          x,
          y: Math.max(b.y + 4, Math.min(baseY + offset, b.y + b.height - height - 4)),
          width,
          height,
        }));
        const free = candidates.filter((c) => !placed.some((other) => overlaps(c, other)));
        const p =
          free.find(
            (c) =>
              width <= 44 ||
              !next.labels.some((label) =>
                overlaps({ ...c, x: c.x + 44, width: c.width - 44 }, label),
              ),
          ) ??
          free[0] ??
          candidates[0];
        placed.push(p);
        node.style.left = `${p.x - origin.x}px`;
        node.style.top = `${p.y - origin.y}px`;
      }
    }
    useImperativeHandle(ref, () => ({ updateLayout }), []);
    useLayoutEffect(() => {
      if (layout.current) updateLayout(layout.current);
    });
    return (
      <div ref={host} className="meter-readouts">
        {meters.map((component) => {
          const open = props.openIds.has(component.id);
          const reading = meterReading(component, props);
          const label = `${component.label} 계기값 ${open ? '축소' : '펼치기'}`;
          return (
            <div
              key={component.id}
              data-meter-id={component.id}
              className="meter-readout"
              style={{ visibility: 'hidden' }}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="meter-readout-toggle"
                aria-label={label}
                data-tooltip={label}
                aria-expanded={open}
                onClick={() => props.onToggle(component.id)}
              >
                {open ? (
                  <CircleMinus size={18} aria-hidden="true" />
                ) : (
                  <CirclePlus size={18} aria-hidden="true" />
                )}
              </button>
              {open && (
                <div title={reading.direction}>
                  <MeasurementDisplay
                    compact
                    reading={reading.text}
                    label={`${component.label} 측정값`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);
