import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { ComponentInstance } from '../domain';
import { componentDefinition } from '../component-library';
import { Notation } from './Notation';

/** Shared selected-component controls, including the compact-screen close action. */
export function ComponentControlPanel({ component, hidden, compact, onClose, children }: {
  component: ComponentInstance;
  hidden?: boolean;
  compact: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const title = componentDefinition(component).name;
  return <section className="parameter-panel" aria-label={`${title} 조절`} hidden={hidden}>
    <div className="section-heading">
      <h2>{title}</h2>
      {compact && <button aria-label={`${title} 조절 닫기`} onClick={onClose}><X size={16} /></button>}
      <span className="parameter-name"><Notation symbol text={component.label} /></span>
    </div>
    {children}
  </section>;
}
