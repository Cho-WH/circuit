import { isChangeoverSwitch, nextSwitchState, type ComponentInstance } from '../domain';

export function SwitchStateButton({component,onToggle,id}:{component:ComponentInstance;onToggle:()=>void;id?:string}) {
  const action = isChangeoverSwitch(component) ? `${nextSwitchState(component).toUpperCase()}로 전환` : `스위치 ${component.properties.state==='closed'?'열기':'닫기'}`;
  return <button id={id} type="button" className="wide-button switch-state-toggle" onClick={onToggle}>{action}</button>;
}
