import { useEffect, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { Point } from '../domain';

type View = Point & {width:number;height:number};
/** Preserve screen scale and the viewed circuit position when the available canvas changes. */
export function useCanvasViewport(svg:RefObject<SVGSVGElement|null>, view:View, setView:Dispatch<SetStateAction<View>>, cancel:()=>void, focus?:Point, editing=false) {
  const [size,setSize]=useState({width:1000,height:620});
  const latest=useRef({view,cancel,focus,editing}); latest.current={view,cancel,focus,editing};
  useEffect(()=>{
    let previous:{width:number;height:number}|null=null;
    let temporary:{width:number;height:number;center:Point;expected:View}|null=null;
    const observer=new ResizeObserver(([entry])=>{
      const {width,height}=entry.contentRect;
      if(width<=0||height<=0||previous?.width===width&&previous.height===height)return;
      const {view:v,cancel,focus,editing}=latest.current;
      if(previous){
        cancel();
        // Restore only our automatic keyboard/editor shift. Any user navigation takes precedence.
        if(temporary&&(Math.abs(width-temporary.width)>1||(['x','y','width','height'] as const).some(k=>Math.abs(v[k]-temporary!.expected[k])>.01)))temporary=null;
        if(!temporary&&editing&&Math.abs(width-previous.width)<=1&&height<previous.height)temporary={...previous,center:{x:v.x+v.width/2,y:v.y+v.height/2},expected:v};
        const scale=Math.max(.01,Math.min(previous.width/v.width,previous.height/v.height));
        const restore=temporary&&height>=temporary.height;
        const center=restore?temporary!.center:{x:v.x+v.width/2,y:v.y+v.height/2};
        const next={x:center.x-width/scale/2,y:center.y-height/scale/2,width:width/scale,height:height/scale};
        if(focus&&!restore){
          const margin=Math.min(64,width/4,height/4)/scale;
          next.x=Math.min(focus.x-margin,Math.max(focus.x-next.width+margin,next.x));
          next.y=Math.min(focus.y-margin,Math.max(focus.y-next.height+margin,next.y));
        }
        setView(next);
        if(restore)temporary=null;else if(temporary)temporary.expected=next;
      }
      previous={width,height};setSize(previous);
    });
    if(svg.current)observer.observe(svg.current);
    return()=>observer.disconnect();
  },[svg,setView]);
  return size;
}
