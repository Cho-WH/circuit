import { useId } from 'react';
import { Zap } from 'lucide-react';
import { createComponent, symbolMarkup, type ComponentKind } from '../component-library';
import { GuideDialog } from './GuideDialog';
import { useDialogFocus } from './useDialogFocus';
import './control-hint.css';

function ControlPreview() {
  const examples: { kind: ComponentKind; name: string; value: string }[] = [
    { kind: 'adjustable-voltage-source', name: '직류 전원', value: '3 V' },
    { kind: 'resistive-load', name: '가변저항', value: '10 Ω' },
    { kind: 'switch', name: '스위치', value: '열림 ↔ 닫힘' },
  ];
  return (
    <svg
      className="quick-start-illustration control-hint-illustration"
      viewBox="0 0 420 168"
      role="img"
      aria-label="직류 전원은 전압, 가변저항은 저항값을 슬라이더로 조절하고 스위치는 열림과 닫힘을 전환하는 예시"
    >
      {examples.map(({ kind, name, value }, i) => (
        <g key={kind} transform={`translate(${70 + 140 * i} 0)`}>
          <text x="0" y="25" textAnchor="middle" fill="#596153" fontSize="12">
            {name}
          </text>
          <g
            transform="translate(0 60) scale(.7)"
            fill="white"
            stroke="#526645"
            color="#526645"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{
              __html: symbolMarkup({
                ...createComponent(kind, 'hint', { x: 0, y: 0 }),
                rotation: 0,
              }),
            }}
          />
          <text x="0" y="108" textAnchor="middle" fill="#30382f" fontSize="14">
            {value}
          </text>
          {i < 2 ? (
            <g strokeLinecap="round">
              <path d="M-40 133H40" stroke="#dce2d4" strokeWidth="5" />
              <path d={`M-40 133H${i === 0 ? 0 : 16}`} stroke="#657955" strokeWidth="5" />
              <circle cx={i === 0 ? 0 : 16} cy="133" r="7" fill="#526645" />
            </g>
          ) : (
            <g>
              <rect x="-23" y="121" width="46" height="24" rx="12" fill="#e4e8de" />
              <circle cx="-10" cy="133" r="9" fill="#fff" stroke="#bcc6b3" />
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

/** One guide shared by all palette entries registered with the analysis-control hint. */
export function ControlHintDialog({ onClose }: { onClose: () => void }) {
  const dialog = useDialogFocus(true, onClose);
  const title = useId();
  return (
    <GuideDialog
      dialogRef={dialog}
      titleId={title}
      title="분석하며 값을 바꿔 보세요"
      eyebrow="조작 가능 부품"
      className="control-hint-dialog"
      size="compact"
      closeLabel="부품 조절 안내 닫기"
      onClose={onClose}
      footer={
        <button className="primary" onClick={onClose}>
          확인
        </button>
      }
    >
      <p>
        <strong>직류 전원·가변저항·스위치</strong>는 <span className="control-hint-mode"><Zap size={14} aria-hidden="true" />분석하기</span>에서 실시간으로 조절할 수 있어요.
      </p>
      <ControlPreview />
      <p>
        <strong><span className="control-hint-mode"><Zap size={14} aria-hidden="true" />분석하기</span> → 회로도에서 부품 클릭(터치)</strong>
        <br />
        패널에 나타나는 조절창에서 값이나 상태를 바꾸세요.
        <br />
        실시간으로 조작하며 측정값의 변화를 살펴볼 수 있어요.
      </p>
    </GuideDialog>
  );
}
