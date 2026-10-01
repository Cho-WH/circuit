import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

/** Shared hints for compact controls, rendered outside scrolling panels. */
export function Tooltip() {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let pending: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      pending = null;
      setAnchor(null);
    };
    const show = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === 'touch') return;
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-tooltip]')
          : null;
      if (!target || !target.dataset.tooltip) return;
      if (pending === target) return;
      hide();
      pending = target;
      timer = setTimeout(() => setAnchor(target), event.type === 'focusin' ? 0 : 400);
    };
    const leave = (event: Event) => {
      const next = (event as MouseEvent | FocusEvent).relatedTarget;
      if (next instanceof Node && (pending?.contains(next) || bubble.current?.contains(next)))
        return;
      hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pending) {
        event.preventDefault();
        event.stopPropagation();
        hide();
      }
    };
    document.addEventListener('pointerover', show);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', show);
    document.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', show);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', show);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!anchor || !bubble.current) return;
    const rect = anchor.getBoundingClientRect();
    const { width, height } = bubble.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 8),
      ),
      top:
        rect.bottom + height + 8 <= window.innerHeight
          ? rect.bottom + 6
          : Math.max(8, rect.top - height - 6),
    });
    const previous = anchor.getAttribute('aria-describedby');
    anchor.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));
    return () => {
      if (previous) anchor.setAttribute('aria-describedby', previous);
      else anchor.removeAttribute('aria-describedby');
    };
  }, [anchor, id]);

  return (
    anchor &&
    createPortal(
      <div ref={bubble} id={id} role="tooltip" className="control-tooltip" style={position}>
        {anchor.dataset.tooltip}
      </div>,
      document.body,
    )
  );
}
