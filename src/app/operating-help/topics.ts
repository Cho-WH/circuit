export type HelpTopic =
  | 'source-terminal-drop'
  | 'source-terminal-rise'
  | 'source-terminal-general'
  | 'source-not-broken'
  | 'source-current'
  | 'source-power'
  | 'diode-forward-voltage'
  | 'diode-current'
  | 'diode-power'
  | 'diode-reverse'
  | 'diode-reverse-current'
  | 'resistor-power';

export interface HelpQuestion {
  topic: HelpTopic;
  damaged?: boolean;
  general?: boolean;
  zeroCurrent?: boolean;
  adjustableSource?: boolean;
}

/** Student copy only. Physics selection and renderer coordinates live elsewhere. */
export function helpText(question: HelpQuestion): { title: string; paragraphs: string[] } {
  const { topic, damaged, general, zeroCurrent } = question;
  const source = question.adjustableSource ? '전원' : '전지';
  const subject = question.adjustableSource ? '전원이' : '전지가';
  switch (topic) {
    case 'source-terminal-drop':
      return {
        title: general
          ? '설정 전압과 측정값은 왜 달라질 수 있나요?'
          : `${source} 전압이 왜 낮아졌나요?`,
        paragraphs: [
          `${source} 안에도 '내부저항'이 있어요. 전류가 작을 때는 그 영향을 무시할 수 있지만, 전류가 많이 흐르면 ${source} 양끝에서 측정하는 전압이 낮아지고 내부에서 열도 더 많이 발생해요.`,
          '지금은 이 영향을 포함한 전압을 보여주고 있어요.',
        ],
      };
    case 'source-terminal-rise':
      return {
        title: `${source} 전압이 왜 더 높게 나오나요?`,
        paragraphs: [
          `다른 전원이 이 ${source} 쪽으로 전류를 밀어 넣고 있어요. 전류가 반대로 흐르면 내부저항에 걸리는 전압의 방향도 바뀌어, ${source} 양끝에서 재는 전압이 더 높아질 수 있어요. ${question.adjustableSource ? '' : '그렇다고 모든 전지를 이렇게 충전할 수 있는 것은 아니에요.'}`,
        ],
      };
    case 'source-terminal-general':
      return {
        title: `${source} 옆 숫자와 측정값은 무엇이 다른가요?`,
        paragraphs: [
          `${source} 옆 숫자는 전류가 흐르지 않을 때의 전압을 나타내요. 탐침은 지금 ${source} 양끝의 전압을 재고 있어요. 전류가 흐르면 내부저항의 영향으로 두 값이 달라질 수 있어요.`,
        ],
      };
    case 'source-not-broken':
      return {
        title: `${subject} 망가진 건가요?`,
        paragraphs: [
          `전압이 낮아졌다고 해서 ${subject} 망가진 것은 아니에요. 전류가 흐르는 동안 내부저항 때문에 양끝의 전압이 낮아질 수 있어요. 이것은 ${subject} 영구적으로 손상된 것과는 달라요.`,
        ],
      };
    case 'source-current':
      return {
        title: damaged
          ? `왜 이 ${subject} 손상된 모습인가요?`
          : `왜 이 ${source}에 과부하가 걸렸나요?`,
        paragraphs: [
          damaged
            ? `${source}에 너무 많은 전류가 흐르면 내부에서 열이 많이 나고 손상될 수 있어요. 지금은 ${subject} 감당하기 어려운 상태여서 손상된 모습으로 보여주고 있어요.`
            : `${subject} 감당하기 어려울 만큼 많은 전류가 흐르고 있어요. ${source} 안에도 저항이 있어서, 전류가 많이 흐를수록 내부에서 열이 더 많이 나요. 지금은 ${source}에 무리가 가는 상태를 보여주고 있어요.`,
        ],
      };
    case 'source-power':
      return {
        title: damaged
          ? `왜 이 ${subject} 손상된 모습인가요?`
          : `왜 이 ${source}에 과부하가 걸렸나요?`,
        paragraphs: [
          damaged
            ? `${source} 내부에서 너무 많은 에너지가 열로 바뀌면 ${subject} 손상될 수 있어요. 지금은 ${subject} 감당하기 어려운 상태여서 손상된 모습으로 보여주고 있어요.`
            : `${source} 안에도 저항이 있어서, 전류가 흐르면 전기 에너지의 일부가 열로 바뀌어요. 지금은 그 양이 너무 커서 ${source}에 무리가 가고 있어요.`,
        ],
      };
    case 'diode-forward-voltage':
      return {
        title: general
          ? '다이오드 옆 숫자와 측정값은 왜 다른가요?'
          : '다이오드 전압은 항상 0.7 V 아닌가요?',
        paragraphs: [
          (general
            ? '수업에서는 다이오드 양끝의 전압을 일정한 값으로 놓고 살펴보기도 해요.'
            : '수업에서는 다이오드에 전류가 흐를 때 양끝의 전압을 0.7 V로 놓고 살펴보곤 해요.') +
            ' 실제로는 흐르는 전류의 양에 따라 이 전압도 달라져요.',
          '지금은 전류가 많아지면 다이오드 양끝의 전압도 높아지는 성질을 함께 보여주고 있어요.',
        ],
      };
    case 'diode-current':
    case 'diode-power':
      return {
        title: '순방향인데 왜 문제가 생겼나요?',
        paragraphs: [
          topic === 'diode-current'
            ? '다이오드는 한쪽 방향으로 전류를 잘 흐르게 하지만, 흐르는 양까지 스스로 제한하지는 못해요. 전류가 너무 많이 흐르면 내부에서 열이 많이 나고 손상될 수 있어요.'
            : '다이오드도 전류가 흐르면 전기 에너지의 일부가 열로 바뀌어요. 순방향으로 연결했더라도 짧은 시간에 열이 너무 많이 나면 손상될 수 있어요.',
          damaged
            ? '지금은 다이오드가 감당하기 어려운 상태여서 손상된 모습으로 보여주고 있어요.'
            : topic === 'diode-current'
              ? '지금은 다이오드가 감당하기 어려울 만큼 많은 전류가 흐르고 있어요.'
              : '지금은 다이오드 안에서 너무 많은 에너지가 열로 바뀌고 있어요.',
        ],
      };
    case 'diode-reverse':
      return {
        title: damaged
          ? '왜 역방향 전압으로 손상됐나요?'
          : zeroCurrent
            ? '전류가 안 흐르는데 왜 위험한가요?'
            : '역방향인데 왜 위험한가요?',
        paragraphs: [
          '다이오드는 반대 방향의 전류를 막아 주지만, 반대 방향의 전압을 얼마든지 견디는 것은 아니에요. 너무 큰 역방향 전압을 걸면 전류를 막는 성질이 무너지고 손상될 수 있어요.',
          damaged
            ? '지금은 너무 큰 역방향 전압을 받아 손상된 모습으로 보여주고 있어요.'
            : zeroCurrent
              ? '지금은 전류가 0으로 보이더라도, 다이오드 양끝의 역방향 전압이 너무 크다는 점을 보여주고 있어요.'
              : '지금은 다이오드 양끝에 걸린 역방향 전압이 너무 큰 상태예요.',
        ],
      };
    case 'diode-reverse-current':
      return {
        title: '실제로도 전류가 안 흐르나요?',
        paragraphs: [
          '실제 다이오드는 역방향 전압이 너무 커지면 반대 방향으로도 전류가 흐를 수 있어요. 이 화면은 그때의 전류까지 나타내지는 않고, 큰 역전압의 위험을 알려주고 있어요.',
        ],
      };
    case 'resistor-power':
      return {
        title: '저항도 손상될 수 있나요?',
        paragraphs: [
          '저항은 전류를 줄여 주지만, 그 안에서도 전기 에너지가 열로 바뀌어요. 짧은 시간에 너무 많은 열이 나면 저항도 손상될 수 있어요.',
          damaged
            ? '지금은 저항이 감당하기 어려운 상태여서 손상된 모습으로 보여주고 있어요.'
            : '지금은 저항이 감당하기 어려울 만큼 열이 많이 나는 상태를 보여주고 있어요.',
        ],
      };
  }
}
