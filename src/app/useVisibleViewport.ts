import { useEffect } from 'react';

/** Keep controls within the visual viewport when the mobile keyboard covers the layout viewport. */
export function useVisibleViewport() {
  useEffect(()=>{
    const viewport=window.visualViewport;
    if(!viewport)return;
    const sync=()=>{
      // Browser page zoom belongs to the browser, not the circuit camera.
      if(viewport.scale!==1)return;
      document.documentElement.style.setProperty('--app-height',`${viewport.height}px`);
    };
    sync();viewport.addEventListener('resize',sync);
    return()=>{viewport.removeEventListener('resize',sync);document.documentElement.style.removeProperty('--app-height');};
  },[]);
}
