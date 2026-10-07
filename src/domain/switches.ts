import type { ComponentInstance } from './index';

/** A switch variant within the existing v6 component/terminal/property structure. */
export function isChangeoverSwitch(component: ComponentInstance): boolean {
  return component.type === 'switch' && component.properties.switchKind === 'spdt';
}

export function validSwitchState(component: ComponentInstance): boolean {
  return isChangeoverSwitch(component)
    ? component.properties.state === 'a' || component.properties.state === 'b'
    : component.properties.state === 'open' || component.properties.state === 'closed';
}

/** Electrical order is common → selected throw, independent of array order/rotation. */
export function switchTerminals(component: ComponentInstance) {
  return isChangeoverSwitch(component)
    ? [component.terminals.find(t => t.role === 'common'), component.terminals.find(t => t.role === `throw-${component.properties.state}`)] as const
    : [component.terminals[0], component.terminals[1]] as const;
}

export function switchClosed(component: ComponentInstance): boolean {
  return component.type === 'switch' && (isChangeoverSwitch(component) || component.properties.state === 'closed');
}

export function nextSwitchState(component: ComponentInstance): string {
  return isChangeoverSwitch(component)
    ? component.properties.state === 'a' ? 'b' : 'a'
    : component.properties.state === 'closed' ? 'open' : 'closed';
}
