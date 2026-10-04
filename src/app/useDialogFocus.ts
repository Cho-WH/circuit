import { useEffect, useRef, type RefObject } from 'react';

/** Keep dialog keyboard focus inside and restore the action which opened it. */
export function useDialogFocus(open:boolean,onClose:()=>void,returnFocus?:RefObject<HTMLElement|null>){
  const ref=useRef<HTMLElement>(null);
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=ref.current;
    const focusable=()=>[...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[])];
    (focusable()[0]??dialog)?.focus();
    const handler=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close.current();}
      if(e.key==='Tab'){
        const targets=focusable(),first=targets[0],last=targets.at(-1);
        if(!first){e.preventDefault();dialog?.focus();}
        else if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',handler,true);
    return()=>{document.removeEventListener('keydown',handler,true);const target=returnFocus?.current??previous;if(target?.isConnected)target.focus({preventScroll:true});};
  },[open,returnFocus]);
  return ref;
}
