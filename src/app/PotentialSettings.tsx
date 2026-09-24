import type { CircuitDocument } from '../domain';
import type { PotentialModel } from '../visualization';
import { endpointName, formatQuantity } from '../component-library';
import { Notation, QuantityInput } from './Notation';

export interface PotentialSettingsValue {
  fixedRange: boolean;
  rangeMin: number;
  rangeMax: number;
  heightScale: number;
}
export const defaultPotentialSettings: PotentialSettingsValue = {
  fixedRange: false,
  rangeMin: 0,
  rangeMax: 12,
  heightScale: 18,
};
interface Props {
  document: CircuitDocument;
  potential: PotentialModel;
  selectedNet: string | null;
  threeDimensional: boolean;
  value: PotentialSettingsValue;
  onChange: (value: PotentialSettingsValue) => void;
}
export function PotentialSettings({
  document: doc,
  potential,
  selectedNet,
  threeDimensional,
  value,
  onChange,
}: Props) {
  const { fixedRange, rangeMin, rangeMax, heightScale } = value;
  const setFixedRange = (fixedRange: boolean) => onChange({ ...value, fixedRange });
  const setRangeMin = (rangeMin: number) => onChange({ ...value, rangeMin });
  const setRangeMax = (rangeMax: number) => onChange({ ...value, rangeMax });
  const setHeightScale = (heightScale: number) => onChange({ ...value, heightScale });
  return (
    <div className="potential-settings">
      {selectedNet && potential.nets[selectedNet] && (
        <div className="net-readout">
          <strong>{formatQuantity(potential.nets[selectedNet].voltage, 'V')}</strong>
          <p>
            {potential.nets[selectedNet].endpointIds.map((id) => endpointName(doc, id)).join(' · ')}
          </p>
        </div>
      )}
      <label className="field-label">
        색상 범위
        <select
          value={fixedRange ? 'fixed' : 'auto'}
          onChange={(e) => setFixedRange(e.target.value === 'fixed')}
        >
          <option value="auto">자동 범위</option>
          <option value="fixed">고정 범위로 비교</option>
        </select>
      </label>
      {fixedRange && (
        <div className="range-inputs">
          <label>
            최소 V
            <QuantityInput
              label="고정 범위 최소"
              unit="V"
              value={rangeMin}
              onChange={setRangeMin}
            />
          </label>
          <label>
            최대 V
            <QuantityInput
              label="고정 범위 최대"
              unit="V"
              value={rangeMax}
              onChange={setRangeMax}
            />
          </label>
        </div>
      )}
      {fixedRange &&
        (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax) || rangeMin >= rangeMax) && (
          <p className="tiny-note">최소보다 큰 최대값을 입력하세요. 현재 자동 범위가 적용됩니다.</p>
        )}
      <label hidden={!threeDimensional} className="field-label">
        높이 ×{Number((heightScale / 18).toFixed(2))}
        <input
          aria-label="높이 강조 배율"
          type="range"
          min="4"
          max="40"
          value={heightScale}
          onChange={(e) => setHeightScale(Number(e.target.value))}
        />
      </label>
      {potential.undefinedCount > 0 && (
        <p className="tiny-note">
          전위 미정 {potential.undefinedCount}개 절점: 회색으로 표시하고 3D 높이를 부여하지
          않습니다.
        </p>
      )}
      <div className="library-divider" />
    </div>
  );
}
