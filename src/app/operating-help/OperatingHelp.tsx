import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { X, ArrowLeft } from 'lucide-react';
import type { ComponentLabelLayout, ScreenRectangle } from '../../visualization';
import { FloatingPanel } from '../FloatingPanel';
import { Notation } from '../Notation';
import { helpText } from './topics';
import type { OperatingHelpItem } from './resolve';
import { placeOperatingHelp } from './layout';
import './operating-help.css';

interface HelpProps {
  item: OperatingHelpItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OperatingHelp({ item, open, onOpenChange }: HelpProps) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const previousKey = useRef(item.key);
  const index = previousKey.current === item.key ? questionIndex : 0;
  const text = helpText(item.questions[index] ?? item.questions[0]);
  useLayoutEffect(() => {
    previousKey.current = item.key;
    setQuestionIndex(0);
  }, [item.key, open]);
  function choose(index: number) {
    setQuestionIndex(index);
  }
  useLayoutEffect(() => {
    if (open) title.current?.focus();
  }, [questionIndex]);
  return (
    <div
      className="operating-help"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <FloatingPanel
        open={open}
        onOpenChange={onOpenChange}
        label={`${item.label}: ${helpText(item.questions[0]).title}`}
        contentLabel={`${item.label}: ${text.title}`}
        trigger={<span aria-hidden="true">?</span>}
        className="operating-help-trigger"
        contentClassName="operating-help-content"
        align="start"
        width={300}
      >
        {(close) => (
          <>
            <div className="operating-help-heading">
              <span>
                <Notation symbol text={item.label} />
              </span>
              <button type="button" aria-label="설명 닫기" onClick={() => close()}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <h3 ref={title} tabIndex={-1}>
              {text.title}
            </h3>
            {text.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {index === 0 && item.questions.length > 1 && (
              <div className="operating-help-related">
                <span>함께 궁금할 수 있어요</span>
                {item.questions.slice(1).map((question, i) => (
                  <button key={question.topic} type="button" onClick={() => choose(i + 1)}>
                    {helpText(question).title}
                  </button>
                ))}
              </div>
            )}
            {index > 0 && (
              <button className="operating-help-back" type="button" onClick={() => choose(0)}>
                <ArrowLeft size={14} aria-hidden="true" />
                돌아가기
              </button>
            )}
          </>
        )}
      </FloatingPanel>
    </div>
  );
}

export interface OperatingHelpOverlayHandle {
  updateLayout: (layout: ComponentLabelLayout) => void;
}
interface OverlayProps {
  items: OperatingHelpItem[];
  openKey: string | null;
  onOpen: (key: string | null) => void;
  onVisible: (ids: string[]) => void;
}

/** Position only on renderer updates; do not create another animation clock or rerender the app per frame. */
export const OperatingHelpOverlay = forwardRef<OperatingHelpOverlayHandle, OverlayProps>(
  function OperatingHelpOverlay(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const layout = useRef<ComponentLabelLayout | null>(null);
    const visible = useRef('');
    const latest = useRef(props);
    latest.current = props;
    function updateLayout(next: ComponentLabelLayout) {
      layout.current = next;
      const root = host.current;
      if (!root) return;
      const stage = root.parentElement;
      const extra: ScreenRectangle[] = [
        ...(stage?.querySelectorAll(
          '.canvas-status-actions,.canvas-view-tools,.current-controls',
        ) ?? []),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const positions = placeOperatingHelp(
        next,
        latest.current.items
          .filter((i) => i.automatic)
          .slice(0, 3)
          .map((i) => i.componentId),
        extra,
      );
      const origin = root.getBoundingClientRect();
      for (const node of root.querySelectorAll<HTMLElement>('[data-help-component]')) {
        const position = positions.get(node.dataset.helpComponent!);
        node.hidden = !position;
        if (position) {
          node.style.left = `${position.x - origin.x}px`;
          node.style.top = `${position.y - origin.y}px`;
          node.style.setProperty('--help-icon-x', `${position.iconX}px`);
          node.style.setProperty('--help-icon-y', `${position.iconY}px`);
        }
      }
      const ids = [...positions.keys()],
        signature = JSON.stringify(ids);
      if (signature !== visible.current) {
        visible.current = signature;
        latest.current.onVisible(ids);
      }
    }
    useImperativeHandle(ref, () => ({ updateLayout }), []);
    useLayoutEffect(() => {
      if (layout.current) updateLayout(layout.current);
    }, [props.items]);
    return (
      <div className="operating-help-overlay" ref={host}>
        {props.items
          .filter((item) => item.automatic)
          .slice(0, 3)
          .map((item) => (
            <div key={item.componentId} data-help-component={item.componentId} hidden>
              <OperatingHelp
                item={item}
                open={props.openKey === item.key}
                onOpenChange={(open) => props.onOpen(open ? item.key : null)}
              />
            </div>
          ))}
      </div>
    );
  },
);
