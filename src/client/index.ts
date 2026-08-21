import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionMapView } from './SessionMapView.tsx'

export { SessionMapView } from './SessionMapView.tsx'

/** Services needed to place Session Map alongside the standard conversation views. */
export const inject = ['slots']

/** Registers one independently unloadable conversation view. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'dsh-seelog-session-map', order: 16,
    label: () => '会话图',
  }, SessionMapView))
}
