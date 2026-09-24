import { useId } from 'react';
import { ArrowRight, Box, FileImage, MessageCircle, Save, X } from 'lucide-react';
import { createComponent, symbolMarkup } from '../component-library';
import type { ComponentType } from '../domain';
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
  const gradient = useId();
  return (
    <svg
      className="quick-start-illustration"
      viewBox="0 0 340 180"
      role="img"
      aria-label="전원과 저항이 연결된 회로의 전위 높이 예시. 6 V 도선은 높게, 0 V 도선은 낮게 놓이고 저항 양 끝에 높이 차이가 생깁니다."
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b65c30" />
          <stop offset="1" stopColor="#405b9b" />
        </linearGradient>
      </defs>
      <path d="M42 144 120 95H302L224 144Z" fill="#e8ede4" stroke="#d1d9cc" />
      <path d="M130 44V100 M284 44V100" stroke="#899383" strokeDasharray="3 5" />
      <path d="M76 134 130 100H284L230 134Z" fill="none" stroke="#bdc7b7" strokeWidth="2" />
      <path d="M130 44H284" stroke="#b65c30" strokeWidth="3" />
      <path d="M76 134H230" stroke="#405b9b" strokeWidth="3" />
      <g color="#536448">
        <Symbol type="dc-voltage-source" transform="matrix(-.614 1.023 -.7 -.42 103 89)" />
      </g>
      <Symbol
        type="resistor"
        transform="matrix(-.614 1.023 -.7 -.42 257 89)"
        stroke={`url(#${gradient})`}
      />
      <g fontSize="15" fontWeight="650">
        <text x="164" y="32" fill="#934421">
          6 V
        </text>
        <text x="138" y="158" fill="#405b9b">
          0 V
        </text>
      </g>
      <path
        d="M309 47V131 M305 51 309 47 313 51 M305 127 309 131 313 127"
        fill="none"
        stroke="#697463"
      />
      <text x="318" y="77" fontSize="13" fill="#526048" writingMode="vertical-rl">
        전위
      </text>
    </svg>
  );
}

function WorksheetPreview() {
  return (
    <svg
      className="quick-start-illustration"
      viewBox="0 0 340 180"
      role="img"
      aria-label="문제지용 회로도 예시. 저항값 자리에 빈칸이 있고 전류 I의 방향이 화살표로 표시되어 있습니다."
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
          d="M223 108H249 M242 104 249 108 242 112"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <text
          x="235"
          y="99"
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

function InsertionPreview() {
  return (
    <svg
      viewBox="0 0 240 82"
      role="img"
      aria-label="도선의 곧은 구간에 저항을 놓으면 양쪽 도선이 저항에 연결됩니다."
    >
      <g color="#567344">
        <g opacity=".5">
          <Symbol type="resistor" transform="translate(58 22) scale(.65)" />
        </g>
        <path
          d="M58 38V48 M54 44 58 48 62 44"
          stroke="currentColor"
          fill="none"
          strokeWidth="1.5"
        />
        <path d="M15 59H100 M142 59H162 M218 59H238" stroke="currentColor" strokeWidth="2" />
        <Symbol type="resistor" transform="translate(190 59) scale(.65)" />
        <path
          d="M110 59H129 M124 54 129 59 124 64"
          fill="none"
          stroke="#7a8075"
          strokeWidth="1.5"
        />
      </g>
    </svg>
  );
}

export function QuickStartDialog({ onClose }: { onClose: () => void }) {
  const dialog = useDialogFocus(true, onClose);
  const title = useId();
  return (
    <div className="modal-backdrop quick-start-backdrop" onClick={onClose}>
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
          <button className="quick-start-close" onClick={onClose} aria-label="도움말 닫기">
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
            직관적인 조작으로 간단히 원하는 회로를 그릴 수 있어요. 부품을 놓고 연결해 회로를 만들고,
            전압·전류를 확인해보세요.
            <br />
            바로 시작할 수 있는 다양한 예제 회로도 준비되어 있어요. 만든 회로도는 예쁘게 출력도
            가능해요.
          </p>
          <div className="quick-start-features">
            <section
              className="quick-start-feature potential"
              aria-labelledby={`${title}-potential`}
            >
              <div className="quick-start-feature-title">
                <Box size={19} aria-hidden="true" />
                <h3 id={`${title}-potential`}>3D로 전위를 살펴보세요</h3>
              </div>
              <PotentialPreview />
              <p>
                평면 회로가 <strong>전위에 따라 높아지고 낮아져요.</strong> <br />
                회로 해석의 핵심인 전위를 눈으로 보고 바로 이해하세요!
              </p>
              <small>전위의 높이에 따라 전류가 어떻게 흐를지 예상해 볼까요?</small>
              <p className="quick-start-route">
                <span>전위 보기</span>
                <ArrowRight size={14} aria-hidden="true" />
                <span>3D</span>
              </p>
            </section>
            <section
              className="quick-start-feature worksheet"
              aria-labelledby={`${title}-worksheet`}
            >
              <div className="quick-start-feature-title">
                <FileImage size={19} aria-hidden="true" />
                <h3 id={`${title}-worksheet`}>문제지에 넣을 그림을 만드세요</h3>
              </div>
              <WorksheetPreview />
              <p>
                값을 숨기거나 <strong>빈칸으로 바꾸고, 화살표와 설명을 더해보세요.</strong> 완성한
                그림은 복사해서 시험지나 수업 자료에 붙여넣으면 돼요.
              </p>
              <small>기호 크기와 위치까지 바꿀 수 있어요!</small>
              <p className="quick-start-route">
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
              <strong>파일 → 회로 파일 저장</strong>을 이용하세요.
            </span>
          </p>
        </div>
        <footer className="quick-start-footer">
          <span>
            사용 후기나 피드백을 남기고 싶다면{' '}
            <strong className="quick-start-feedback-label">
              <MessageCircle size={14} aria-hidden="true" />
              한마디
            </strong>
            를 눌러주세요!
          </span>
          <button className="primary" onClick={onClose}>
            직접 해보기
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </footer>
      </section>
    </div>
  );
}
