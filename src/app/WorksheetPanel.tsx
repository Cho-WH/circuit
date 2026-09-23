import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CircleDot, MousePointer2, Type, Undo2, Redo2, Trash2 } from 'lucide-react';
import { Notation } from './Notation';
import { useDialogFocus } from './useDialogFocus';
import type { CircuitDocument, SimulationResult } from '../domain';
import type { Command } from '../editor';
import { componentPresentation } from '../component-library';
import { exportSvg, exportPng, copyPng, type ExportOptions } from '../export';
import type { OutputTool } from './OutputCanvas';
interface Props {
  active?: boolean; document: CircuitDocument; result: SimulationResult; selected: string[];
  tool: OutputTool; onTool: (tool: OutputTool) => void;
  options: ExportOptions; onOptions: (options: ExportOptions) => void;
  onFontPreview: (scale:number|null) => void;
  onSelect: (id: string) => void; dispatch: (command: Command) => boolean;
  onNotice: (message: string) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
}
function saveBlob(blob: Blob, filename: string) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
export function WorksheetPanel(props: Props) {
  const {document:doc}=props;
  const component=doc.components.find(c=>c.id===props.selected[0]);
  const annotation=doc.annotations.find(a=>a.id===props.selected[0]);
  const [busy,setBusy]=useState(false),[preview,setPreview]=useState<string|null>(null);
  const [toolbar,setToolbar]=useState<HTMLElement|null>(null);
  const [fontScale,setFontScale]=useState(doc.output?.fontScale??1);
  useEffect(()=>setFontScale(doc.output?.fontScale??1),[doc.output?.fontScale]);
  useEffect(()=>{setToolbar(props.active?window.document.getElementById('worksheet-actions'):null);},[props.active]);
  const previewDialog=useDialogFocus(Boolean(preview),()=>setPreview(null));
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  const options=props.options;
  async function output(action:'svg'|'png'|'copy'|'preview') {
    setBusy(true);
    try {
      const name=doc.title||'회로도';
      if(action==='svg')saveBlob(new Blob([exportSvg(doc,options,props.result)],{type:'image/svg+xml;charset=utf-8'}),name+'.svg');
      else if(action==='copy'){const copied=await copyPng(doc,options,props.result);if(copied.copied)props.onNotice('그림을 복사했습니다.');else{saveBlob(copied.blob,name+'.png');props.onNotice('그림 복사를 지원하지 않아 PNG로 저장했습니다.');}}
      else {const blob=await exportPng(doc,options,props.result);if(action==='preview')setPreview(URL.createObjectURL(blob));else saveBlob(blob,name+'.png');}
    }catch{props.onNotice('출력을 만들지 못했습니다. 다시 시도해 주세요.');}
    finally{setBusy(false);}
  }
  function property(values:Record<string,string|number|boolean>){if(component)props.dispatch({type:'SetProperties',id:component.id,properties:values});}
  function scaleCommit(){if(fontScale!==(doc.output?.fontScale??1))props.dispatch({type:'SetOutputScale',scale:fontScale});props.onFontPreview(null);}
  const actual=component?componentPresentation({...component,properties:Object.fromEntries(Object.entries(component.properties).filter(([k])=>! /^(label|answer)/.test(k)))},props.result):null;
  return <section className="worksheet-panel"><h3>표시 설정</h3>
    {toolbar&&createPortal(<>
      <div className="tool-group">{([{id:'select',label:'선택',Icon:MousePointer2},{id:'point',label:'점',Icon:CircleDot},{id:'arrow',label:'전류 화살표',Icon:ArrowRight},{id:'note',label:'글자',Icon:Type}] as const).map(({id,label,Icon})=><button key={id} title={label} aria-label={label} aria-pressed={props.tool===id} className={props.tool===id?'active':''} onClick={()=>props.onTool(id)}><Icon size={18}/></button>)}</div>
      <label className="output-font-scale"><Type size={17}/><input aria-label="글자 크기 배율" type="range" min="0.5" max="2" step="0.05" value={fontScale} onChange={e=>{setFontScale(e.target.valueAsNumber);props.onFontPreview(e.target.valueAsNumber);}} onPointerCancel={()=>{setFontScale(doc.output?.fontScale??1);props.onFontPreview(null);}} onPointerUp={scaleCommit} onKeyUp={scaleCommit} onBlur={scaleCommit}/><output>{Math.round(fontScale*100)}%</output></label>
      <div className="tool-group"><button aria-label="출력 실행 취소" disabled={!props.canUndo} onClick={props.undo}><Undo2 size={17}/></button><button aria-label="출력 다시 실행" disabled={!props.canRedo} onClick={props.redo}><Redo2 size={17}/></button></div>
      <button disabled={busy} onClick={()=>void output('preview')}>미리보기</button><button className="primary" disabled={busy} onClick={()=>void output('copy')}>그림 복사</button><details className="export-menu"><summary>파일 저장</summary><button disabled={busy} onClick={()=>void output('svg')}>SVG 저장</button><button disabled={busy} onClick={()=>void output('png')}>PNG 저장</button></details>
    </>,toolbar)}
    {component&&<><h4><Notation symbol text={component.label}/></h4>{[{prefix:'label',label:'기호·이름',value:actual?.label},{prefix:'answer',label:'값',value:actual?.value}].map(({prefix,label,value})=>{
      const visible=component.properties[prefix+'Visible']!==false&&component.properties[prefix+'Display']!=='hidden';
      const blank=component.properties[prefix+'Blank']===true||component.properties[prefix+'Display']==='blank';
      return <div className="output-notation" key={component.id+prefix}><div className="output-field-heading"><label htmlFor={'output-'+prefix}>{label}</label><input role="switch" aria-label={label+' 표시'} type="checkbox" checked={visible} onChange={e=>property({[prefix+'Visible']:e.target.checked,...(component.properties[prefix+'Display']==='hidden'?{[prefix+'Display']:component.properties[prefix+'Text']===undefined?'value':'custom'}:{})})}/></div>
        <input id={'output-'+prefix} aria-label={label+' 출력 문자'} value={String(component.properties[prefix+'Text']??(component.properties[prefix+'Display']==='?'?'?':value??''))} maxLength={160} onChange={e=>property({[prefix+'Text']:e.target.value,[prefix+'Display']:'custom'})}/>
        <label className="check-label"><input type="checkbox" checked={blank} onChange={e=>property({[prefix+'Blank']:e.target.checked,...(component.properties[prefix+'Display']==='blank'?{[prefix+'Display']:component.properties[prefix+'Text']===undefined?'value':'custom'}:{})})}/>빈칸 □</label>
        <button className="output-reset" onClick={()=>property({[prefix+'OffsetX']:0,[prefix+'OffsetY']:0})}>위치 초기화</button>
      </div>;
    })}</>}
    {annotation&&<div className="annotation-edit"><h4>{annotation.kind==='point'?'점':annotation.kind==='arrow'?'전류 화살표':'글자'}</h4><input aria-label="주석 내용 편집" value={annotation.content} maxLength={240} onChange={e=>props.dispatch({type:'UpdateAnnotation',id:annotation.id,changes:{content:e.target.value}})}/><button aria-label="선택한 장식 삭제" onClick={()=>props.dispatch({type:'DeleteElements',ids:[annotation.id]})}><Trash2 size={16}/>삭제</button></div>}
    <div className="annotation-list">{doc.annotations.filter(a=>a.visibility!=='hidden').map(a=><button key={a.id} className={annotation?.id===a.id?'active':''} onClick={()=>props.onSelect(a.id)}>{a.kind==='point'?'● ':a.kind==='arrow'?'→ ':''}<Notation symbol={a.kind==='point'||a.kind==='arrow'} text={a.content||'□'}/></button>)}</div>
    <div className="output-export-options">
      <label className="check-label"><input type="checkbox" role="switch" checked={options.showGround??false} onChange={e=>props.onOptions({...options,showGround:e.target.checked})}/>접지 표시</label>
      <label className="check-label"><input type="checkbox" role="switch" checked={options.background==='transparent'} onChange={e=>props.onOptions({...options,background:e.target.checked?'transparent':'white'})}/>투명 배경</label>
      <label className="check-label"><input type="checkbox" role="switch" checked={options.highResolution??false} onChange={e=>props.onOptions({...options,highResolution:e.target.checked})}/>고해상도 출력</label>
    </div>
    {preview&&createPortal(<div className="modal-backdrop" onClick={()=>setPreview(null)}><section ref={previewDialog} tabIndex={-1} className="export-preview" role="dialog" aria-modal="true" aria-label="PNG 출력 미리보기" onClick={e=>e.stopPropagation()}><header><h2>회로도 출력</h2><button onClick={()=>setPreview(null)} aria-label="출력 미리보기 닫기">닫기 ×</button></header><div className="preview-image"><img src={preview} alt="내보낼 회로 PNG"/></div></section></div>,window.document.body)}
  </section>;
}
