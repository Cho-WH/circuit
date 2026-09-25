export function SwitchStateButton({closed,onToggle,id}:{closed:boolean;onToggle:()=>void;id?:string}) {
  return <button id={id} type="button" className="wide-button switch-state-toggle" onClick={onToggle}>스위치 {closed?'열기':'닫기'}</button>;
}
