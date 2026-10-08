import { isChangeoverSwitch, nextSwitchState, type ComponentInstance } from '../domain';

export function SwitchStateButton({component,onToggle,id,disabled=false}:{component:ComponentInstance;onToggle:()=>void;id?:string;disabled?:boolean}) {
  const action = isChangeoverSwitch(component) ? `${nextSwitchState(component).toUpperCase()}로 전환` : `스위치 ${component.properties.state==='closed'?'열기':'닫기'}`;
  return <button id={id} type="button" className="wide-button switch-state-toggle" disabled={disabled} onClick={onToggle}>{action}</button>;
}
