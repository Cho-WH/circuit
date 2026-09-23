import { useEffect, useRef, useState } from 'react';
import { Archive, Check, ChevronDown, Download, FolderOpen, Plus, RotateCcw } from 'lucide-react';
import { loadLocal, saveLocal } from '../persistence';
import type { CircuitDocument } from '../domain';

interface Props {
  document: CircuitDocument;
  onOpen: () => void;
  onSave: () => void;
  onNew: () => void;
  onRestore: (document: CircuitDocument) => void;
  onNotice: (message: string, kind?: 'status' | 'error') => void;
}

export function FileMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(() => loadLocal('manual'));
  const [stored, setStored] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    setSaved(loadLocal('manual'));
    setStored(false);
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open]);
  function close(action: () => void) { setOpen(false); trigger.current?.focus(); action(); }
  return <div className="file-menu" ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} aria-expanded={open} aria-controls="file-actions" onClick={() => setOpen(!open)}>파일<ChevronDown size={14}/></button>
    {open && <div id="file-actions" className="file-menu-content" aria-label="파일 작업">
      <button onClick={() => close(props.onNew)}><Plus size={17}/>새 회로</button>
      <button onClick={() => close(props.onOpen)}><FolderOpen size={17}/>회로 파일 열기</button>
      <button onClick={() => close(props.onSave)}><Download size={17}/>회로 파일 저장</button>
      <hr/>
      <button onClick={() => {
        const result = saveLocal(props.document, 'manual');
        if (result.ok) { setSaved(loadLocal('manual')); setStored(true); }
        else props.onNotice('회로를 보관하지 못했어요. 회로 파일로 저장해 주세요.', 'error');
      }}>{stored ? <Check size={17}/> : <Archive size={17}/>}<span role={stored ? 'status' : undefined}>{stored ? '보관했어요' : '현재 회로 보관'}</span></button>
      <button disabled={!saved?.ok} onClick={() => {
        const current = loadLocal('manual');
        if (current?.ok) close(() => props.onRestore(current.document));
        else { setSaved(current); props.onNotice('보관한 회로를 불러오지 못했어요. 회로 파일을 열어 주세요.', 'error'); }
      }}><RotateCcw size={17}/>보관한 회로 불러오기</button>
      {saved?.ok && <p className="saved-circuit-name">{saved.document.title || '이름 없는 회로'}</p>}
      <p>자동 저장과 보관은 이 브라우저에 남아요.<br/>다른 곳에서 쓰려면 회로 파일로 저장하세요.</p>
    </div>}
  </div>;
}
