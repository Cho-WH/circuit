import type { OperatingAssessment } from '../simulation';
type Cause = OperatingAssessment['components'][number];

export function operatingReason(cause: Cause, damaged = false) {
  switch (cause.reason) {
    case 'reverseVoltage': return damaged ? '역방향 전압이 너무 커서 손상됐어요' : '역방향 전압이 너무 커요';
    case 'power':
    case 'internalPower': return damaged ? '전력이 너무 커서 손상됐어요' : '감당할 수 있는 전력을 넘었어요';
    default: return damaged ? '전류가 너무 커서 손상됐어요' : '흐르는 전류가 너무 커요';
  }
}
