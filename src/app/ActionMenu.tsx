import {useId,useLayoutEffect,useEffect,useRef,useState,type ReactNode,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';
interface Props {
 label:string;contentLabel:string;className?:string;align?:'start'|'end';onOpen?:()=>void;
 children:(close:(action?:()=>void)=>void)=>ReactNode;
}
/** Shared trigger, floating placement, dismissal and keyboard navigation for action menus. */
export function ActionMenu({label,contentLabel,className='',align='end',onOpen,children}:Props){
 const [open,setOpen]=useState(false),id=useId();
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState({left:8,top:8,maxHeight:400});
 const close=(action?:()=>void)=>{setOpen(false);trigger.current?.focus();action?.();};
 function show(){onOpen?.();setOpen(true);}
 const contains=(target:EventTarget|null)=>target instanceof Node&&(root.current?.contains(target)||panel.current?.contains(target));
 useLayoutEffect(()=>{
  if(!open||!trigger.current||!panel.current)return;
  const rect=trigger.current.getBoundingClientRect(),width=Math.min(258,window.innerWidth-16);
  const below=Math.max(0,window.innerHeight-rect.bottom-16),above=Math.max(0,rect.top-16);
  const height=panel.current.getBoundingClientRect().height,down=height<=below||below>=above;
  setPosition({left:Math.max(8,Math.min(window.innerWidth-width-8,align==='end'?rect.right-width:rect.left)),top:down?rect.bottom+8:Math.max(8,rect.top-Math.min(height,above)-8),maxHeight:down?below:above});
  panel.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
 },[open,align]);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!contains(e.target))setOpen(false);};
  const layout=(e:Event)=>{if(!(e.target instanceof Node&&panel.current?.contains(e.target)))setOpen(false);};
  window.addEventListener('pointerdown',outside);window.addEventListener('resize',layout);window.addEventListener('scroll',layout,true);
  return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('resize',layout);window.removeEventListener('scroll',layout,true);};
 },[open]);
 function keys(e:KeyboardEvent){
  e.stopPropagation();
  if(e.key==='Escape'){e.preventDefault();close();return;}
  if(e.key==='Tab'){close();return;}
  const items=[...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[])];
  const index=items.indexOf(window.document.activeElement as HTMLButtonElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(index+1)%items.length:e.key==='ArrowUp'?(index+items.length-1)%items.length:null;
  if(next!==null){e.preventDefault();items[next]?.focus();}
 }
 return <div className={'action-menu '+className} ref={root} onBlur={e=>{if(!contains(e.relatedTarget))setOpen(false);}}>
  <button type="button" className="action-menu-trigger" ref={trigger} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>open?close():show()} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();show();}}}>{label}<ChevronDown size={14} aria-hidden="true"/></button>
  {open&&createPortal(<div ref={panel} id={id} className="action-menu-content" role="menu" aria-label={contentLabel} style={position} onKeyDown={keys}>{children(close)}</div>,window.document.body)}
 </div>;
}
