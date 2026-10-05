/** Session-only decoration. Never included in document symbols or worksheet output. */
export interface ComponentOperatingMark {
  state: 'overload' | 'breaking' | 'broken';
  event: number;
  label: string;
}

export function operatingMarkSvg(state: ComponentOperatingMark['state']): string {
  const ring = '<rect x="-29" y="-24" width="58" height="48" rx="14" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>';
  if (state === 'overload') return ring + '<path d="M25 -28v8m0 4v1" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>';
  return ring + '<path class="damage-crack" d="M-10 -15L1 -4 -5 3 11 16" fill="none" stroke="var(--surface,#fcfbf8)" stroke-width="8"/><path d="M-10 -15L1 -4 -5 3 11 16" fill="none" stroke="currentColor" stroke-width="3"/>' +
    (state === 'breaking' ? '<path class="damage-burst" d="M-36 -22l-8 -6M36 -22l8 -6M-38 15l-9 4M38 15l9 4M0 -30v-10M0 30v10" fill="none" stroke="currentColor" stroke-width="2"/>' : '');
}
