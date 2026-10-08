import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';

/** Shared guide surface; callers retain their focus and optional exit animation. */
export function GuideDialog({
  dialogRef,
  scrimRef,
  titleId,
  title,
  eyebrow,
  onClose,
  children,
  footer,
  className = '',
  firstVisit,
  closing,
  closeLabel = '도움말 닫기',
  dismissible = true,
  size = 'wide',
}: {
  dialogRef: RefObject<HTMLElement | null>;
  scrimRef?: RefObject<HTMLDivElement | null>;
  titleId: string;
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  className?: string;
  firstVisit?: boolean;
  closing?: boolean;
  closeLabel?: string;
  dismissible?: boolean;
  size?: 'wide' | 'compact';
}) {
  return (
    <div
      className="modal-backdrop quick-start-backdrop"
      data-first-visit={firstVisit || undefined}
      data-closing={closing || undefined}
      onClick={dismissible ? onClose : undefined}
    >
      <div ref={scrimRef} className="quick-start-scrim" aria-hidden="true" />
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`quick-start-dialog ${className}`}
        data-size={size}
        data-dismissible={dismissible}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="quick-start-header">
          <span className="quick-start-eyebrow">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
          {dismissible && <button className="quick-start-close" onClick={onClose} aria-label={closeLabel}>
            <X size={20} />
          </button>}
        </header>
        <div
          className="quick-start-body"
          role="region"
          aria-label={`${eyebrow} 안내 내용`}
          tabIndex={0}
        >
          {children}
        </div>
        <footer className="quick-start-footer">{footer}</footer>
      </section>
    </div>
  );
}
