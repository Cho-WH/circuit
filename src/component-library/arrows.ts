import type { Annotation, ArrowStyle, Point } from '../domain';

/** Legacy endpoint arrows retain their exact direction and size until edited. */
export function arrowStyle(annotation: Annotation, position: Point): ArrowStyle {
  if(annotation.arrow)return annotation.arrow;
  const end=annotation.end??{x:position.x+64,y:position.y};
  return {shape:'straight',length:Math.hypot(end.x-position.x,end.y-position.y),legLength:48,rotation:Math.atan2(end.y-position.y,end.x-position.x)*180/Math.PI,reversed:false};
}
export function arrowGeometry(annotation: Annotation, position: Point) {
  const style=arrowStyle(annotation,position), angle=style.rotation*Math.PI/180;
  const transform=(x:number,y:number):Point=>({x:position.x+x*Math.cos(angle)-y*Math.sin(angle),y:position.y+x*Math.sin(angle)+y*Math.cos(angle)});
  const points=[position,transform(style.length,0),...(style.shape==='corner'?[transform(style.length,style.legLength)]:[])];
  let path=points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join('');
  if(style.shape==='corner') {
    const radius=Math.min(16,style.length*.35,style.legLength*.35);
    if(radius>0){
      const before=transform(style.length-radius,0),after=transform(style.length,radius),end=points[2];
      path=`M${position.x} ${position.y}L${before.x} ${before.y}A${radius} ${radius} 0 0 1 ${after.x} ${after.y}L${end.x} ${end.y}`;
    }
  }
  const directed=style.reversed?[...points].reverse():points;
  const tip=directed.at(-1)!,previous=directed.at(-2)!;
  const length=Math.hypot(tip.x-previous.x,tip.y-previous.y)||1, ux=(tip.x-previous.x)/length,uy=(tip.y-previous.y)/length;
  const size=Math.min(10,length*.45),half=size*.38;
  const head=[tip,{x:tip.x-size*ux+half*uy,y:tip.y-size*uy-half*ux},{x:tip.x-size*.72*ux,y:tip.y-size*.72*uy},{x:tip.x-size*ux-half*uy,y:tip.y-size*uy+half*ux}];
  return {style,points,path,head:head.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join('')+'Z'};
}

/** Resize along the existing segment axis; the opposite end/corner stays fixed. */
export function resizeArrow(annotation:Annotation,position:Point,end:'start'|'end',delta:Point) {
  const style=arrowStyle(annotation,position),angle=style.rotation*Math.PI/180;
  const ux=Math.cos(angle),uy=Math.sin(angle);
  const along=delta.x*ux+delta.y*uy,across=-delta.x*uy+delta.y*ux;
  const clamp=(length:number)=>Math.max(16,Math.min(2000,length));
  if(end==='start') {
    const length=clamp(style.length-along),shift=style.length-length;
    return {anchor:null,position:{x:position.x+shift*ux,y:position.y+shift*uy},arrow:{...style,length}};
  }
  return {arrow:style.shape==='corner'?{...style,legLength:clamp(style.legLength+across)}:{...style,length:clamp(style.length+along)}};
}
