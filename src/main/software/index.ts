import type { ServerType } from '@shared/types'
import type { ServerProvider } from './types'
import { paper } from './paper'
import { folia } from './folia'
import { purpur } from './purpur'
import { vanilla } from './vanilla'
import { fabric } from './fabric'
import { quilt } from './quilt'
import { forge } from './forge'
import { neoforge } from './neoforge'
import { velocity } from './velocity'
import { waterfall } from './waterfall'
import { bungeecord } from './bungeecord'

const PROVIDERS: Record<ServerType, ServerProvider> = {
  paper,
  folia,
  purpur,
  vanilla,
  fabric,
  quilt,
  forge,
  neoforge,
  velocity,
  waterfall,
  bungeecord
}

export function getProvider(type: ServerType): ServerProvider {
  const provider = PROVIDERS[type]
  if (!provider) throw new Error(`No provider for server type "${type}"`)
  return provider
}
