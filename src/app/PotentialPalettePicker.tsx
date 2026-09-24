import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { potentialColor, potentialGradient, potentialPalette, potentialPalettes, type PotentialPaletteId } from '../visualization';
import './potential-palette.css';

interface Props { value: PotentialPaletteId; min: number; max: number; onChange: (palette: PotentialPaletteId) => void }

export function PotentialPalettePicker({ value, min, max, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 264, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const current = potentialPalette(value);
  function close(restoreFocus = false) { setOpen(false); if (restoreFocus) trigger.current?.focus(); }
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(264, window.innerWidth - 16);
    const height = Math.min(menu.current!.offsetHeight, window.innerHeight - 16);
    const below = rect.bottom + 6;
    setPosition({ width, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(below + height <= window.innerHeight - 8 ? below : rect.top - height - 6, window.innerHeight - height - 8)),
      maxHeight: window.innerHeight - 16 });
    items.current[potentialPalettes.findIndex(palette => palette.id === value)]?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!trigger.current?.contains(node) && !menu.current?.contains(node)) close();
    };
    const reposition = () => close();
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="potential-palette-trigger" aria-label={`전위 색상표 선택: ${current.name}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true); }
        if (event.key === 'Escape' && open) { event.stopPropagation(); close(true); }
      }}>
      <span className="potential-palette-ramp" aria-hidden="true" style={{ background: min === max ? potentialColor(min, min, max, value) : potentialGradient(value) }}/>
      <ChevronDown size={13} aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label="전위 색상표" className="potential-palette-menu" style={position}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close(); }}
      onKeyDown={event => {
        // Palette navigation must never move/delete the selected circuit elements.
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === 'Tab') { close(true); return; }
        const index = items.current.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % potentialPalettes.length
          : event.key === 'ArrowUp' ? (index + potentialPalettes.length - 1) % potentialPalettes.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? potentialPalettes.length - 1 : null;
        if (next !== null) { event.preventDefault(); items.current[next]?.focus(); }
      }}>
      <div className="potential-palette-caption" aria-hidden="true"><span>낮은 전위</span><span>높은 전위</span></div>
      {potentialPalettes.map((palette, index) => <button key={palette.id} ref={node => { items.current[index] = node; }} type="button"
        role="menuitemradio" aria-checked={value === palette.id} tabIndex={value === palette.id ? 0 : -1}
        aria-label={palette.name} onClick={() => { onChange(palette.id); close(true); }}>
        <span className="potential-palette-ramp" aria-hidden="true" style={{ background: potentialGradient(palette.id) }}/>
        <span className="potential-palette-check" aria-hidden="true">{value === palette.id && <Check size={14}/>}</span>
      </button>)}
    </div>, document.body)}
  </>;
}
