import { ActionMenu } from './ActionMenu';
import { useState } from 'react';
import { Archive, Check, Download, FolderOpen, Plus, RotateCcw } from 'lucide-react';
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
  const [saved, setSaved] = useState(() => loadLocal('manual'));
  const [stored, setStored] = useState(false);
  return <ActionMenu label="파일" contentLabel="파일 작업" className="file-menu" onOpen={()=>{setSaved(loadLocal('manual'));setStored(false);}}>{close=><>
      <button type="button" role="menuitem" onClick={() => close(props.onNew)}><Plus size={17}/>새 회로</button>
      <button type="button" role="menuitem" onClick={() => close(props.onOpen)}><FolderOpen size={17}/>회로 파일 열기</button>
      <button type="button" role="menuitem" onClick={() => close(props.onSave)}><Download size={17}/>회로 파일 저장</button>
      <hr/>
      <button type="button" role="menuitem" onClick={() => {
        const result = saveLocal(props.document, 'manual');
        if (result.ok) { setSaved(loadLocal('manual')); setStored(true); }
        else props.onNotice('회로를 보관하지 못했어요. 회로 파일로 저장해 주세요.', 'error');
      }}>{stored ? <Check size={17}/> : <Archive size={17}/>}<span role={stored ? 'status' : undefined}>{stored ? '보관했어요' : '현재 회로 보관'}</span></button>
      <button type="button" role="menuitem" disabled={!saved?.ok} onClick={() => {
        const current = loadLocal('manual');
        if (current?.ok) close(() => props.onRestore(current.document));
        else { setSaved(current); props.onNotice('보관한 회로를 불러오지 못했어요. 회로 파일을 열어 주세요.', 'error'); }
      }}><RotateCcw size={17}/>보관한 회로 불러오기</button>
      {saved?.ok && <p className="saved-circuit-name">{saved.document.title || '이름 없는 회로'}</p>}
      <p>자동 저장과 보관은 이 브라우저에 남아요.<br/>다른 곳에서 쓰려면 회로 파일로 저장하세요.</p>
    </>}</ActionMenu>;
}
