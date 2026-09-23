import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from './useDialogFocus';
import type { Annotation, CircuitDocument, SimulationResult } from '../domain';
import type { Command } from '../editor';
import type { NumberFormat, WorksheetMode } from '../component-library';
import { exportSvg, exportPng, copyPng, type ExportOptions } from '../export';

interface Props {
  active?: boolean;
  document: CircuitDocument; result: SimulationResult; selected: string[];
  mode: WorksheetMode; onMode: (mode: WorksheetMode) => void;
  numberFormat: NumberFormat; onNumberFormat: (format: NumberFormat) => void;
  anchor: string; onAnchor: (id: string) => void; onSelect: (id: string) => void;
  dispatch: (command: Command) => boolean; newId: (prefix: string) => string; onNotice: (message: string) => void;
}
const rules = [{value:'value',label:'실제 값'},{value:'hidden',label:'숨김'},{value:'?',label:'물음표 ?'},{value:'blank',label:'빈칸'},{value:'custom',label:'문자'}];
const kinds: {value:Annotation['kind'];label:string}[] = [{value:'label',label:'점 이름'},{value:'arrow',label:'전류 화살표'},{value:'blank',label:'빈칸'},{value:'question',label:'미지수·질문'},{value:'note',label:'설명'}];
const visibility: {value:Annotation['visibility'];label:string}[] = [{value:'always',label:'문제·정답 모두'},{value:'problem',label:'문제만'},{value:'answer',label:'정답만'},{value:'hidden',label:'숨김'}];
function saveBlob(blob: Blob, filename: string) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
export function WorksheetPanel(props: Props) {
  const {document:doc,mode,numberFormat} = props;
  const component = doc.components.find(c=>c.id===props.selected[0]); const annotation=doc.annotations.find(a=>a.id===props.selected[0]);
  const [annotationKind,setAnnotationKind] = useState<Annotation['kind']>('label');
  const [content,setContent] = useState('A'); const [visible,setVisible]=useState<Annotation['visibility']>('always');
  const [monochrome,setMonochrome]=useState(true);const [transparent,setTransparent]=useState(false);const [margin,setMargin]=useState(48);const [scale,setScale]=useState(3);
  const [busy,setBusy]=useState(false);const [preview,setPreview]=useState<string|null>(null);
  const [toolbar,setToolbar]=useState<HTMLElement|null>(null);
  useEffect(()=>{setToolbar(props.active?window.document.getElementById('worksheet-actions'):null);},[props.active]);
  const previewDialog=useDialogFocus(Boolean(preview),()=>setPreview(null));
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  useEffect(()=>{if(!preview)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setPreview(null);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[preview]);
  const endpoints=[...doc.components.flatMap(c=>c.terminals.map(t=>({kind:'terminal' as const,id:t.id}))),...doc.junctions.map(j=>({kind:'junction' as const,id:j.id}))];
  const anchor=endpoints.find(e=>e.id===props.anchor)??(component?{kind:'terminal' as const,id:component.terminals[0].id}:endpoints[0]);
  const options:ExportOptions={mode,numberFormat,monochrome,background:transparent?'transparent':'white',margin,pngScale:scale};
  async function output(action:'svg'|'png'|'copy'|'preview') {
    setBusy(true);
    try {
      const name=`${doc.title||'회로'}-${mode==='problem'?'문제':'정답'}`;
      if(action==='svg'){saveBlob(new Blob([exportSvg(doc,options,props.result)],{type:'image/svg+xml;charset=utf-8'}),name+'.svg');props.onNotice('선과 글자를 유지한 SVG를 저장했습니다.');}
      else if(action==='copy'){const copied=await copyPng(doc,options,props.result);if(copied.copied)props.onNotice('PNG를 복사했습니다. 문서에 붙여넣으세요.');else{saveBlob(copied.blob,name+'.png');props.onNotice('이 브라우저에서는 그림 복사를 사용할 수 없어 같은 PNG를 파일로 저장했습니다.');}}
      else {const blob=await exportPng(doc,options,props.result);if(action==='preview')setPreview(URL.createObjectURL(blob));else{saveBlob(blob,name+'.png');props.onNotice('고해상도 PNG를 저장했습니다.');}}
    }catch{props.onNotice('출력을 만들지 못했습니다. 유효한 여백·배율을 입력하고 큰 회로라면 배율을 줄여 주세요.');}
    finally{setBusy(false);}
  }
  function property(key:string,value:string|number|boolean){if(component)props.dispatch({type:'SetProperties',id:component.id,properties:{[key]:value}});}
  return <section className="worksheet-panel"><h3>표시 설정</h3>{toolbar&&createPortal(<><div className="segmented worksheet-modes"><button aria-pressed={mode==='problem'} className={mode==='problem'?'active':''} onClick={()=>props.onMode('problem')}>문제지</button><button aria-pressed={mode==='answer'} className={mode==='answer'?'active':''} onClick={()=>props.onMode('answer')}>정답지</button></div><button disabled={busy} onClick={()=>void output('preview')}>미리보기</button><button className="primary" disabled={busy} onClick={()=>void output('copy')}>{busy?'이미지 만드는 중…':'그림 복사'}</button><details className="export-menu"><summary>파일 저장</summary><button disabled={busy} onClick={()=>void output('svg')}>SVG 저장</button><button disabled={busy} onClick={()=>void output('png')}>PNG 저장</button></details></>,toolbar)}<p className="tiny-note">같은 회로의 표기만 바뀝니다. 정답지에는 실제 값이 표시됩니다.</p>
    {component?<><h4>{component.label} 표시 규칙</h4>{[{prefix:'answer',label:'부품값'},{prefix:'label',label:'이름'},{prefix:'voltage',label:'양단 전압'},{prefix:'current',label:'가지 전류'}].map(({prefix,label})=><div className="notation-rule" key={prefix}>{(prefix==='voltage'||prefix==='current')&&<label className="check-label"><input type="checkbox" checked={component.properties[prefix==='voltage'?'showVoltage':'showCurrent']===true} onChange={e=>property(prefix==='voltage'?'showVoltage':'showCurrent',e.target.checked)}/>{label} 표시</label>}<label className="field-label">문제의 {label}<select aria-label={`${label} 문제 표시`} value={String(component.properties[prefix+'Display']??'value')} onChange={e=>property(prefix+'Display',e.target.value)}>{rules.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label>{component.properties[prefix+'Display']==='custom'&&<input aria-label={`${label} 표시 문자`} value={String(component.properties[prefix+'Text']??'x')} onChange={e=>property(prefix+'Text',e.target.value)} maxLength={160}/>}</div>)}</>:<p className="tiny-note">부품을 선택하면 값·이름·전압·전류의 표시 규칙을 정할 수 있습니다.</p>}
    <details className="measurement-details" open={Boolean(annotation)}><summary>점 이름·화살표·주석</summary><p className="tiny-note">캔버스의 단자·분기점을 눌러 위치를 정하세요. 화살표는 오른쪽을 향합니다.</p><label className="field-label">주석 위치<select aria-label="주석 위치" value={anchor?.id??''} onChange={e=>props.onAnchor(e.target.value)}>{endpoints.map(e=><option key={e.id}>{e.id}</option>)}</select></label><label className="field-label">주석 종류<select aria-label="주석 종류" value={annotationKind} onChange={e=>setAnnotationKind(e.target.value as Annotation['kind'])}>{kinds.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</select></label><label className="field-label">주석 내용<input aria-label="새 주석 내용" value={content} onChange={e=>setContent(e.target.value)} placeholder={annotationKind==='blank'?'빈칸':annotationKind==='question'?'?':'A'} maxLength={240}/></label><label className="field-label">표시할 문서<select aria-label="새 주석 가시성" value={visible} onChange={e=>setVisible(e.target.value as Annotation['visibility'])}>{visibility.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</select></label><button className="wide-button" disabled={!anchor} onClick={()=>{if(!anchor)return;const id=props.newId('note-');if(props.dispatch({type:'AddAnnotation',annotation:{id,kind:annotationKind,anchor,content,visibility:visible}}))props.onSelect(id);}}>주석 추가</button>
      {annotation&&<div className="annotation-edit"><h4>선택한 주석 편집</h4><input aria-label="주석 내용 편집" key={annotation.id+':'+annotation.content} defaultValue={annotation.content} maxLength={240} onBlur={e=>props.dispatch({type:'UpdateAnnotation',id:annotation.id,changes:{content:e.target.value}})}/><select aria-label="주석 가시성 편집" value={annotation.visibility} onChange={e=>props.dispatch({type:'UpdateAnnotation',id:annotation.id,changes:{visibility:e.target.value as Annotation['visibility']}})}>{visibility.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</select><button className="wide-button" onClick={()=>props.dispatch({type:'DeleteElements',ids:[annotation.id]})}>이 주석 삭제</button></div>}
      <div className="annotation-list">{doc.annotations.map(a=><button key={a.id} className={annotation?.id===a.id?'active':''} onClick={()=>props.onSelect(a.id)}>{a.content||kinds.find(k=>k.value===a.kind)?.label} <small>{a.anchor.id}</small></button>)}</div>
    </details>
    <details className="measurement-details"><summary>숫자·인쇄 옵션</summary><label className="field-label">숫자 형식<select aria-label="출력 숫자 형식" value={numberFormat.kind} onChange={e=>props.onNumberFormat(e.target.value==='integer'?{kind:'integer'}:{kind:e.target.value as 'fixed'|'significant',digits:e.target.value==='fixed'?2:3})}><option value="significant">유효숫자 · SI 접두어</option><option value="fixed">소수 자리수 · 기본 단위</option><option value="integer">정수 · 기본 단위</option></select></label>{numberFormat.kind!=='integer'&&<label className="field-label">자리수<input aria-label="출력 자리수" type="number" min={numberFormat.kind==='fixed'?0:1} max="10" value={numberFormat.digits} onChange={e=>props.onNumberFormat({...numberFormat,digits:e.target.valueAsNumber})}/></label>}<label className="check-label"><input type="checkbox" checked={monochrome} onChange={e=>setMonochrome(e.target.checked)}/>흑백 출력</label><label className="check-label"><input type="checkbox" checked={transparent} onChange={e=>setTransparent(e.target.checked)}/>투명 배경</label><label className="field-label">여백 (회로 단위)<input aria-label="출력 여백" type="number" min="0" max="300" value={margin} onChange={e=>setMargin(e.target.valueAsNumber)}/></label><label className="field-label">PNG 배율<select aria-label="PNG 배율" value={scale} onChange={e=>setScale(Number(e.target.value))}>{[1,2,3,4].map(n=><option key={n} value={n}>{n}×</option>)}</select></label></details>
    <p className="tiny-note">상단에서 미리보기·그림 복사를 사용하세요. 선택 테두리와 화면 배율은 출력에 포함되지 않습니다.</p>
    {preview&&createPortal(<div className="modal-backdrop" onClick={()=>setPreview(null)}><section ref={previewDialog} tabIndex={-1} className="export-preview" role="dialog" aria-modal="true" aria-label="PNG 출력 미리보기" onClick={e=>e.stopPropagation()}><header><h2>{mode==='problem'?'문제지':'정답지'} · 실제 PNG</h2><button onClick={()=>setPreview(null)} aria-label="출력 미리보기 닫기">닫기 ×</button></header><div className="preview-image"><img src={preview} alt="내보낼 회로 PNG"/></div><p>SVG·PNG는 같은 표시 규칙과 기호를 사용합니다. Esc로 닫을 수 있습니다.</p></section></div>,window.document.body)}
  </section>;
}
