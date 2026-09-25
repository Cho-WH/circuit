import {Check} from 'lucide-react';
import {ActionMenu} from './ActionMenu';
import {examples} from '../fixtures';
import {layoutExample} from './examples';
import type {CircuitDocument} from '../domain';
export function ExampleMenu({documentId,onSelect}:{documentId:string;onSelect:(document:CircuitDocument)=>void}){
 return <ActionMenu label="예제 회로" contentLabel="예제 회로 목록" className="example-menu" align="start">{close=>examples.map(example=><button key={example.id} type="button" role="menuitemradio" aria-checked={example.document.documentId===documentId} onClick={()=>close(()=>onSelect(layoutExample(example.document)))}><span>{example.title}</span>{example.document.documentId===documentId&&<Check size={16} aria-hidden="true"/>}</button>)}</ActionMenu>;
}
