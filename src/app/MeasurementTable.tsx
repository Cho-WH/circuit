import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, RotateCcw, Trash2, X } from 'lucide-react';
import type { MeasurementEntry } from '../persistence';
import { Notation } from './Notation';
import { saveBlob } from './download';
import { CircuitCanvas } from './CircuitCanvas';
import { useDialogFocus } from './useDialogFocus';
import {
  conditionValues,
  measurementQuantityName,
  measurementConditions,
  measurementDirection,
  measurementLocation,
  measurementTableHtml,
  measurementTableText,
  measurementValue,
} from './measurement-records';

function ConditionSummary({ entry }: { entry: MeasurementEntry }) {
  return (
    <div className="record-condition-summary">
      <span className="record-circuit-name">{entry.record.documentSnapshot.title}</span>
      <div className="record-condition-values">
        {conditionValues(entry).map(({ label, value }, index) => (
          <span className="record-condition-value" key={index}>
            <Notation symbol text={label} />
            <span>{value}</span>
          </span>
        ))}
        {entry.sourcesDisconnected && <span className="record-isolation">모든 전원 분리</span>}
      </div>
    </div>
  );
}

const noop = () => {};
function RecordPreview({ entry, onClose }: { entry: MeasurementEntry; onClose: () => void }) {
  const dialog = useDialogFocus(true, onClose);
  const { record: r } = entry;
  const doc = r.documentSnapshot;
  const current = r.quantity === 'current';
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        tabIndex={-1}
        className="record-preview"
        role="dialog"
        aria-modal="true"
        aria-label="기록 당시 회로"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h3>기록 당시 회로</h3>
          <button onClick={onClose} aria-label="기록 회로 닫기">
            <X size={18} />
          </button>
        </header>
        <div className="record-preview-reading">
          <Notation text={measurementLocation(entry)} />
          <span className="record-quantity">{measurementQuantityName(entry)}</span>
          <strong>{measurementValue(entry)}</strong>
          {current && <Notation text={measurementDirection(entry)} />}
        </div>
        <ConditionSummary entry={entry} />
        <div className="record-preview-circuit" inert>
          <CircuitCanvas
            document={doc}
            selected={current ? r.targetIds : []}
            tool="select"
            placement={null}
            readOnly
            readOnlyLabel="기록 당시 회로"
            onSelect={noop}
            onMove={noop}
            onPlace={noop}
            onEndpoint={noop}
            onWire={noop}
            onValue={noop}
            onSwitch={noop}
            onBackground={noop}
            highlightedElements={current ? r.targetIds : undefined}
            measurement={{
              tool: current ? 'current' : 'red',
              anchors: entry.anchors,
              amperes: current ? (r.value ?? undefined) : undefined,
              disconnectSources: entry.sourcesDisconnected,
              onPlace: noop,
              onActivate: noop,
            }}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}

interface Props {
  entries: MeasurementEntry[];
  open: boolean;
  storageWarning: string;
  onClose: () => void;
  onNote: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}
export function MeasurementTable({
  entries,
  open,
  storageWarning,
  onClose,
  onNote,
  onDelete,
  onClear,
}: Props) {
  const [message, setMessage] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = entries.find((entry) => entry.id === previewId);
  const groups = measurementConditions(entries);
  async function copy() {
    try {
      const text = measurementTableText(entries);
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([measurementTableHtml(entries)], { type: 'text/html' }),
          }),
        ]);
      } else await navigator.clipboard.writeText(text);
      setMessage('표를 복사했어요.');
    } catch {
      setMessage('표를 복사하지 못했어요. CSV 저장을 이용해 주세요.');
    }
  }
  return (
    <aside
      id="measurement-notebook"
      hidden={!open}
      className="measure-notebook"
      aria-label="측정표"
    >
      <div className="notebook-heading">
        <h3>
          측정표 <span>{entries.length}</span>
        </h3>
        <div className="record-actions">
          <span className="record-table-status" role="status">
            {message}
          </span>
          <button disabled={!entries.length} onClick={copy}>
            <Copy size={14} />표 복사
          </button>
          <button
            disabled={!entries.length}
            onClick={() => {
              onClear();
              setPreviewId(null);
              setMessage('기록을 초기화했어요.');
            }}
          >
            <RotateCcw size={14} />
            기록 초기화
          </button>
          <button
            disabled={!entries.length}
            onClick={() =>
              saveBlob(
                new Blob(['\uFEFF' + measurementTableText(entries, ',')], {
                  type: 'text/csv;charset=utf-8',
                }),
                '회로-측정표.csv',
              )
            }
          >
            <Download size={14} />
            CSV 저장
          </button>
          <button onClick={onClose} aria-label="분석 패널 닫기">
            <X size={17} />
          </button>
        </div>
      </div>
      {storageWarning && (
        <p className="record-storage-warning" role="status">
          {storageWarning}
        </p>
      )}
      <div className="record-scroll">
        {entries.length === 0 ? (
          <p className="records-empty">비교할 측정값을 ‘기록’으로 담아 보세요.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">기록</th>
                <th scope="col">측정 위치</th>
                <th scope="col">측정</th>
                <th scope="col">측정값</th>
                <th scope="col">메모</th>
                <th scope="col">
                  <span className="measurement-sr-only">삭제</span>
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.entry.id}>
                <tr className="record-condition">
                  <th colSpan={6} scope="rowgroup">
                    <div className="record-condition-heading">
                      <strong>조건 {group.number}</strong>
                      <ConditionSummary entry={group.entry} />
                    </div>
                  </th>
                </tr>
                {group.entries.map((entry) => {
                  const index = entries.indexOf(entry) + 1;
                  return (
                    <tr key={entry.id} className="measurement-record">
                      <td>{index}</td>
                      <td>
                        <button
                          className="record-location"
                          title={`기록 당시 회로 보기 · ${measurementDirection(entry)}`}
                          onClick={() => setPreviewId(entry.id)}
                        >
                          <Notation text={measurementLocation(entry)} />
                        </button>
                      </td>
                      <td className="record-quantity">{measurementQuantityName(entry)}</td>
                      <td className="record-value">{measurementValue(entry)}</td>
                      <td>
                        <input
                          aria-label={`기록 ${index} 메모`}
                          placeholder="메모 추가"
                          value={entry.note}
                          onChange={(e) => onNote(entry.id, e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          className="record-delete"
                          aria-label={`기록 ${index} 삭제`}
                          onClick={() => onDelete(entry.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        )}
      </div>
      {open && preview && <RecordPreview entry={preview} onClose={() => setPreviewId(null)} />}
    </aside>
  );
}
