import { randomUUID } from 'node:crypto'
import type { Instance } from '@shared/types'
import { isProxy } from '@shared/software'
import { updateInstance, instanceDir } from '../store/instances'
import { setServerProperties } from './properties'

/**
 * Provision app-managed local RCON for a server (used for silent TPS polling).
 * Generates credentials once, then keeps server.properties in sync every start.
 */
export function ensureRcon(root: string, inst: Instance): Instance {
  if (isProxy(inst.serverType)) return inst
  let rcon = inst.rcon
  if (!rcon) {
    // Derive a port away from the game port; wrap back into range for high ports.
    let rconPort = inst.port + 10000
    if (rconPort > 65535) rconPort = inst.port - 10000
    if (rconPort < 1024) rconPort = 25575
    rcon = { port: rconPort, password: randomUUID().replace(/-/g, '') }
    updateInstance(root, inst.id, { rcon })
  }
  setServerProperties(instanceDir(root, inst.id), {
    'enable-rcon': 'true',
    'rcon.port': rcon.port,
    'rcon.password': rcon.password,
    'broadcast-rcon-to-ops': 'false'
  })
  return { ...inst, rcon }
}
