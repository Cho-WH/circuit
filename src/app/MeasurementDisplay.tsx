import type { ReactNode } from 'react';
import './measurement.css';

/** Shared LCD typography; the caller supplies the already formatted measurement. */
export function MeasurementDisplay({
  reading,
  label = '측정값',
  compact = false,
  children,
}: {
  reading: string;
  label?: string;
  compact?: boolean;
  children?: ReactNode;
}) {
  const unitStart = reading.lastIndexOf(' ');
  const value = unitStart < 0 ? reading : reading.slice(0, unitStart);
  const unit = unitStart < 0 ? '' : reading.slice(unitStart + 1);
  return (
    <div
      className={`measure-lcd${compact ? ' measure-lcd--compact' : ''}`}
      style={
        compact
          ? { width: Math.min(260, Math.max(68, value.length * 13 + unit.length * 9 + 24)) }
          : undefined
      }
    >
      {children}
      <output aria-label={label} aria-live={compact ? 'off' : 'polite'} aria-atomic="true">
        <span
          className="measure-lcd-value"
          style={
            compact
              ? undefined
              : {
                  fontSize: `clamp(18px, calc((100cqi - 34px) / ${Math.max(1, value.length * 0.62)}), 46px)`,
                }
          }
        >
          {value}
        </span>{' '}
        <span className="measure-lcd-unit">{unit}</span>
      </output>
    </div>
  );
}
