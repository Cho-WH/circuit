import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { FloatingPanel } from './FloatingPanel';
interface Props {
  label: string;
  contentLabel: string;
  className?: string;
  align?: 'start' | 'end';
  onOpen?: () => void;
  trigger?: ReactNode;
  children: (close: (action?: () => void) => void) => ReactNode;
}
export function ActionMenu({
  label,
  contentLabel,
  className = '',
  align = 'end',
  onOpen,
  trigger,
  children,
}: Props) {
  return (
    <FloatingPanel
      label={label}
      trigger={trigger ??
        <>
          {label}
          <ChevronDown size={14} aria-hidden="true" />
        </>
      }
      contentLabel={contentLabel}
      className={'action-menu ' + className}
      contentClassName="action-menu-content"
      role="menu"
      align={align}
      onOpen={onOpen}
    >
      {children}
    </FloatingPanel>
  );
}
