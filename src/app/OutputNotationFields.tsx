import { ComponentNameInput } from './ComponentNameInput';
import { useId } from 'react';
interface Props {
  properties: Record<string, string | number | boolean>;
  label: string | null | undefined;
  value: string | null | undefined;
  onChange: (values: Record<string, string | number | boolean>) => void;
  onLabelChange?: (label: string) => boolean;
}
export function OutputNotationFields({ properties, label, value, onChange, onLabelChange }: Props) {
  const fieldId = useId();
  return (
    <>
      {[
        { prefix: 'label', label: '기호·이름', value: label },
        { prefix: 'answer', label: '값', value },
      ].map(({ prefix, label, value }) => {
        const visible =
          properties[prefix + 'Visible'] !== false &&
          (!!onLabelChange || properties[prefix + 'Display'] !== 'hidden');
        const blank =
          properties[prefix + 'Blank'] === true ||
          (!onLabelChange && properties[prefix + 'Display'] === 'blank');
        const defaultDisplay =
          onLabelChange || properties[prefix + 'Text'] === undefined ? 'value' : 'custom';
        return (
          <div className="output-notation" key={prefix}>
            <div className="output-field-heading">
              <label htmlFor={fieldId + '-' + prefix}>{label}</label>
              <input
                role="switch"
                aria-label={label + ' 표시'}
                type="checkbox"
                checked={visible}
                onChange={(e) =>
                  onChange({
                    [prefix + 'Visible']: e.target.checked,
                    ...(!onLabelChange && properties[prefix + 'Display'] === 'hidden'
                      ? { [prefix + 'Display']: defaultDisplay }
                      : {}),
                  })
                }
              />
            </div>
            {onLabelChange && prefix === 'answer' ? (
              <output id={fieldId + '-' + prefix} aria-label="실제 부품 값">
                {value}
              </output>
            ) : onLabelChange ? (
              <ComponentNameInput id={fieldId + '-' + prefix} label="기호·이름" value={value??''} onCommit={onLabelChange}/>
            ) : (
              <input
                id={fieldId + '-' + prefix}
                aria-label={label + ' 출력 문자'}
                value={String(
                  (properties[prefix + 'Text'] ??
                        (properties[prefix + 'Display'] === '?' ? '?' : (value ?? ''))),
                )}
                maxLength={160}
                onChange={(e) =>
                  onChange({
                        [prefix + 'Text']: e.target.value,
                        [prefix + 'Display']: 'custom',
                      })
                }
              />
            )}
            {onLabelChange && prefix === 'answer' && (
              <small>값은 회로 만들기에서 수정합니다.</small>
            )}
            <div className="output-field-actions">
              <label className="check-label">
                <input
                  type="checkbox"
                  aria-label={label + ' 빈칸'}
                  checked={blank}
                  onChange={(e) =>
                    onChange({
                      [prefix + 'Blank']: e.target.checked,
                      ...(!onLabelChange && properties[prefix + 'Display'] === 'blank'
                        ? { [prefix + 'Display']: defaultDisplay }
                        : {}),
                    })
                  }
                />
                빈칸 □
              </label>
              <button
                className="output-reset"
                aria-label={label + ' 위치 초기화'}
                onClick={() => onChange({ [prefix + 'OffsetX']: 0, [prefix + 'OffsetY']: 0 })}
              >
                위치 초기화
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
