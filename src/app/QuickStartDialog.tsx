import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ArrowRight, Box, FileImage, MessageCircle, Save, X } from 'lucide-react';
import { createComponent, symbolMarkup } from '../component-library';
import type { ComponentType } from '../domain';
import { potentialColor } from '../visualization';
import { ProbeGlyph } from './measurement-tools';
import { useDialogFocus } from './useDialogFocus';
import './quick-start.css';

// Use the same symbols as the editor and exported circuit diagrams.
function Symbol({
  type,
  transform,
  stroke = 'currentColor',
}: {
  type: ComponentType;
  transform: string;
  stroke?: string;
}) {
  return (
    <g
      transform={transform}
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{
        __html: symbolMarkup(createComponent(type, 'preview', { x: 0, y: 0 })),
      }}
    />
  );
}

function PotentialPreview() {
  const high = potentialColor(6, 0, 6);
  const low = potentialColor(0, 0, 6);
  return (
    <svg
      className="quick-start-illustration"
      viewBox="0 0 340 200"
      role="img"
      aria-label="앱의 3D 분석 예시. 바닥 회로도 위에 6 V 도선은 빨강으로 높게, 0 V 도선은 남색으로 낮게 표시됩니다. 전류 띠와 흐름 무늬, 두 지점의 전압 탐침을 함께 볼 수 있습니다."
    >
      {/* A static projection keeps the guide light; symbols, palette and probes are shared. */}
      <g transform="matrix(.88 .13 -.32 .5 112 101)">
        <g stroke="#deded5" strokeWidth=".7" opacity=".65">
          {[0, 22, 44, 66, 88, 110].map((y) => (
            <path key={`y${y}`} d={`M-20 ${y}H240`} />
          ))}
          {[-20, 24, 68, 112, 156, 200, 240].map((x) => (
            <path key={`x${x}`} d={`M${x} -14V124`} />
          ))}
        </g>
        <g color="#72796e" opacity=".75">
          <path
            d="M0 33V0H220V33 M220 77V110H0V77"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <Symbol type="dc-voltage-source" transform="translate(0 55) rotate(90) scale(.5)" />
          <Symbol type="resistor" transform="translate(220 55) rotate(90) scale(.5)" />
          <g fill="currentColor" fontSize="15" fontFamily="Libertinus Math, serif">
            <text x="14" y="60">
              6 V
            </text>
            <text x="169" y="59">
              100 Ω
            </text>
          </g>
        </g>
      </g>
      <g fill="none" stroke="#7e8a72" strokeWidth=".6">
        {[0, 17, 34, 51, 68].map((height) => (
          <path
            key={height}
            d={`M49 ${166 - height} 95 ${94 - height} 316 ${127 - height}`}
            strokeDasharray={height ? '2 4' : undefined}
            opacity={height ? '.45' : '.7'}
          />
        ))}
        <path d="M49 94V170 M316 55V131" />
        <path d="M112 33V101 M305.6 61.6V129.6" strokeDasharray="2 4" opacity=".6" />
      </g>
      <g fill="#66745a" fontSize="10" textAnchor="end">
        <text x="43" y="102">
          6 V
        </text>
        <text x="43" y="136">
          3 V
        </text>
        <text x="43" y="170">
          0 V
        </text>
      </g>
      <g fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity=".65">
        <path d="M101.4 49.5 112 33 305.6 61.6 295 78.1" stroke={high} />
        <path d="M295 78.1 281 168.1 M87.4 139.5 101.4 49.5" stroke="#586879" />
        <path d="M281 168.1 270.4 184.6 76.8 156 87.4 139.5" stroke={low} />
      </g>
      <path
        d="M112 33 305.6 61.6 295 78.1 281 168.1 270.4 184.6 76.8 156 87.4 139.5 101.4 49.5Z"
        fill="none"
        stroke="white"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeDasharray=".1 14"
      />
      <g fill="#30382f" fontSize="14" fontStyle="italic" fontFamily="Libertinus Math, serif">
        <text x="105" y="96">
          V₁
        </text>
        <text x="296" y="127">
          R₁
        </text>
      </g>
      <g transform="translate(208 47)">
        <circle r="4" fill="#bc4541" stroke="white" strokeWidth="1.5" />
        <g transform="rotate(26) scale(.6)">
          <ProbeGlyph />
        </g>
      </g>
      <g transform="translate(174 170.4)">
        <circle r="4" fill="#34413a" stroke="white" strokeWidth="1.5" />
        <g transform="rotate(-26) scale(.6)">
          <ProbeGlyph color="black" />
        </g>
      </g>
      <g fill="#30382f" fontSize="12" fontFamily="Libertinus Math, serif" textAnchor="middle">
        <rect x="240" y="31" width="34" height="20" rx="4" fill="white" />
        <text x="257" y="45">
          6 V
        </text>
        <rect x="202" y="179" width="34" height="20" rx="4" fill="white" />
        <text x="219" y="193">
          0 V
        </text>
      </g>
    </svg>
  );
}

function WorksheetPreview() {
  return (
    <svg
      className="quick-start-illustration"
      viewBox="0 -10 340 200"
      role="img"
      aria-label="문제지용 회로도 예시. 저항값 자리에 빈칸이 있고 아래 도선 중앙의 전류 I 화살표가 왼쪽을 향합니다."
    >
      <rect x="30" y="10" width="280" height="160" rx="4" fill="#fff" stroke="#d7d4cc" />
      <path d="M48 28H103" stroke="#d5d2c9" strokeWidth="3" strokeLinecap="round" />
      <g color="#383e35">
        <path
          d="M72 73H126 M214 73H265V140H72V128 M72 92V73"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <Symbol type="resistor" transform="translate(170 73)" />
        <Symbol type="dc-voltage-source" transform="translate(72 110) rotate(90) scale(.42)" />
        <path
          d="M183 130H155 M162 126 155 130 162 134"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <text
          x="169"
          y="121"
          textAnchor="middle"
          fontSize="16"
          fontStyle="italic"
          fill="currentColor"
        >
          I
        </text>
        <text x="101" y="116" fontSize="14" fill="currentColor">
          6 V
        </text>
        <rect x="153" y="38" width="28" height="20" rx="2" fill="#f6f4ee" stroke="currentColor" />
        <text x="188" y="54" fontSize="15" fill="currentColor">
          Ω
        </text>
      </g>
    </svg>
  );
}

export function QuickStartDialog({ onClose, compact, firstVisit, helpButton }: {
  onClose: () => void;
  compact: boolean;
  firstVisit: boolean;
  helpButton: RefObject<HTMLButtonElement | null>;
}) {
  const [closing, setClosing] = useState(false);
  const closingRequested = useRef(false);
  const scrim = useRef<HTMLDivElement>(null);
  function requestClose() {
    if (closingRequested.current) return;
    closingRequested.current = true;
    setClosing(true);
  }
  const dialog = useDialogFocus(true, requestClose, helpButton);
  const title = useId();

  useEffect(() => {
    if (!closing) return;
    const surface = dialog.current;
    const target = helpButton.current;
    if (!surface || typeof surface.animate !== 'function') {
      onClose();
      return;
    }
    const from = surface.getBoundingClientRect();
    const to = target?.getBoundingClientRect();
    const dock = firstVisit && to && to.width > 0 && to.height > 0 && from.width > 0 && from.height > 0;
    const animations: Animation[] = [];
    const animate = (element: Element, frames: Keyframe[], duration: number, easing = 'ease-out') => {
      const animation = element.animate(frames, { duration, easing, fill: 'forwards' });
      // Auxiliary fades may still be running if the dialog unmounts early.
      void animation.finished.catch(() => {});
      animations.push(animation);
      return animation;
    };
    let active = true;
    let exit: Animation;
    if (dock) {
      const dx = to.x + to.width / 2 - (from.x + from.width / 2);
      const dy = to.y + to.height / 2 - (from.y + from.height / 2);
      // Keep the dimmer in place so the light surface stays visible throughout its journey.
      for (const child of surface.children) animate(child, [{ opacity: 1 }, { opacity: 0 }], 220);
      const style = getComputedStyle(surface);
      const radius = style.borderRadius;
      const startOpacity = Number(style.opacity);
      // The browser interpolates these continuous curves at the display refresh rate.
      // Motion uses transforms instead of changing layout dimensions.
      const frames = Array.from({ length: 61 }, (_, index) => {
        const t = index / 60;
        const travel = t * t * (3 - 2 * t);
        const arrival = Math.max(0, (t - .82) / .18);
        const diameter = (56 - 20 * t) * (1 - arrival * arrival * (3 - 2 * arrival));
        const width = diameter + (from.width - diameter) * (1 - t) ** 3;
        const height = diameter + (from.height - diameter) * (1 - t) ** 3;
        return {
          offset: t,
          transform: `translate(${dx * (2 * travel - travel * travel)}px, ${dy * travel * travel}px) scale(${width / from.width}, ${height / from.height})`,
          borderRadius: t === 0 ? radius : `${Math.min(50, 3 + t * 94)}%`,
          opacity: Math.min(1, (1 - t) / .04) * (startOpacity + (1 - startOpacity) * Math.min(1, t / .15)),
        };
      });
      exit = animate(surface, frames, 1000, 'linear');
    } else {
      exit = animate(surface, [{ opacity: 1 }, { opacity: 0 }], 120);
    }
    const fadeScrim = (duration: number) => scrim.current
      ? animate(scrim.current, [{ opacity: 1 }, { opacity: 0 }], duration, 'cubic-bezier(.2, .65, .3, 1)').finished
      : Promise.resolve();
    const finish = () => { if (active) onClose(); };
    const arrive = () => {
      if (!active) return;
      if (dock && target?.isConnected) {
        animate(target, [
          { transform: 'scale(1)' },
          { transform: 'scale(1.16)', offset: .35 },
          { transform: 'scale(1)' },
        ], 360);
      }
      return fadeScrim(400).then(finish, finish);
    };
    if (dock) void exit.finished.then(arrive, finish);
    else void Promise.all([exit.finished, fadeScrim(120)]).then(finish, finish);
    return () => {
      active = false;
      animations.forEach(animation => animation.cancel());
    };
  }, [closing, firstVisit, helpButton, onClose, dialog]);

  return (
    <div className="modal-backdrop quick-start-backdrop" data-first-visit={firstVisit || undefined} data-closing={closing || undefined} onClick={requestClose}>
      <div ref={scrim} className="quick-start-scrim" aria-hidden="true" />
      <section
        ref={dialog}
        tabIndex={-1}
        className="quick-start-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="quick-start-header">
          <span className="quick-start-eyebrow">빠른 시작</span>
          <h2 id={title}>회로 분석과 수업 자료까지</h2>
          <button className="quick-start-close" onClick={requestClose} aria-label="도움말 닫기">
            <X size={20} />
          </button>
        </header>
        <div
          className="quick-start-body"
          role="region"
          aria-label="빠른 시작 안내 내용"
          tabIndex={0}
        >
          <p className="quick-start-build">
            <strong>
              {compact
                ? '+ 부품에서 예제 회로를 열거나 부품을 골라 놓으세요.'
                : '예제 회로를 열거나 왼쪽 목록에서 부품을 골라 놓으세요.'}
            </strong>
            <br />
            단자 두 곳을 차례로 누르면 도선으로 연결돼요.
          </p>
          <div className="quick-start-features">
            <section
              className="quick-start-feature potential"
              aria-labelledby={`${title}-potential`}
            >
              <div className="quick-start-feature-title">
                <Box size={19} aria-hidden="true" />
                <h3 id={`${title}-potential`}>3D로 회로를 분석하세요</h3>
              </div>
              <PotentialPreview />
              <p>
                <strong>전위는 높이로, 전류는 흐름으로</strong> 살펴보세요. 탐침과 센서로
                전압·전류를 측정하고 비교해 보세요.
              </p>
              <small>회로를 살펴보는 시선을 한 차원 높여보세요!</small>
              <div className="quick-start-routes">
                <p className="quick-start-route">
                  <b>3D 보기</b>
                  <span>분석하기</span>
                  <ArrowRight size={12} aria-hidden="true" />
                  <span>3D</span>
                </p>
                <p className="quick-start-route">
                  <b>측정하기</b>
                  <span>분석하기</span>
                  <ArrowRight size={12} aria-hidden="true" />
                  <span>{compact ? '측정' : '왼쪽 측정 도구'}</span>
                </p>
              </div>
            </section>
            <section
              className="quick-start-feature worksheet"
              aria-labelledby={`${title}-worksheet`}
            >
              <div className="quick-start-feature-title">
                <FileImage size={19} aria-hidden="true" />
                <h3 id={`${title}-worksheet`}>문제지에 넣을 회로도를 만드세요</h3>
              </div>
              <WorksheetPreview />
              <p>
                {compact ? (
                  <>
                    완성한 회로를 <strong>그림으로 복사하거나 저장하세요.</strong> 시험지나 수업
                    자료에 바로 넣을 수 있어요.
                  </>
                ) : (
                  <>
                    값을 숨기거나 <strong>빈칸·화살표·설명을 더해보세요.</strong> 그림을 복사해
                    시험지나 수업 자료에 넣을 수 있어요.
                  </>
                )}
              </p>
              <small>
                {compact
                  ? '글자 배치와 주석 편집은 넓은 화면에서 할 수 있어요.'
                  : '글자 크기와 이름·값 위치도 바꿀 수 있어요.'}
              </small>
              <p className="quick-start-route quick-start-output-route">
                {compact && (
                  <>
                    <span>상단 ⋯</span>
                    <ArrowRight size={12} aria-hidden="true" />
                  </>
                )}
                <span>회로도 출력</span>
                <ArrowRight size={14} aria-hidden="true" />
                <span>그림 복사</span>
              </p>
            </section>
          </div>
          <p className="quick-start-save">
            <Save size={17} aria-hidden="true" />
            <span>
              자동 저장은 이 브라우저에만 남아요. 따로 보관하려면{' '}
              <strong>{compact ? '상단 ⋯' : '파일'} → 회로 파일 저장</strong>을 이용하세요.
            </span>
          </p>
        </div>
        <footer className="quick-start-footer">
          <span>
            후기·제안은 상단{' '}
            <strong className="quick-start-feedback-label">
              <MessageCircle size={14} aria-hidden="true" />
              {compact ? '말풍선' : '한마디'}
            </strong>
            에 남겨주세요.
          </span>
          <button className="primary" onClick={requestClose}>
            직접 해보기
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </footer>
      </section>
    </div>
  );
}
