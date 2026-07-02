// Pre-share safety check: a server exposed through a tunnel with
// online-mode=false and no whitelist accepts any client, including cracked
// ones — which bots scan for. The check reads server.properties; the fixes
// write it (a running server picks them up on restart).

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { isProxy } from '@shared/software'
import type { ServerType, ShareSafety, ShareSafetyFix } from '@shared/types'
import { readServerProperties, setServerProperties } from './properties'

/** Inspect a server's auth setup ahead of exposing it publicly. */
export function checkShareSafety(dir: string, type: ServerType): ShareSafety {
  // Proxies keep auth in their own configs (velocity.toml/config.yml) and
  // their backends run offline behind forwarding — out of scope for this check.
  if (isProxy(type)) return { checked: false, risky: false }
  if (!existsSync(join(dir, 'server.properties'))) return { checked: false, risky: false }

  const props = readServerProperties(dir)
  const onlineMode = (props['online-mode'] ?? 'true').trim().toLowerCase() !== 'false'
  const whitelist = (props['white-list'] ?? 'false').trim().toLowerCase() === 'true'
  return { checked: true, onlineMode, whitelist, risky: !onlineMode && !whitelist }
}

/** Apply a one-click remediation and return the re-checked result. */
export function applyShareSafetyFix(dir: string, type: ServerType, fix: ShareSafetyFix): ShareSafety {
  if (fix === 'online-mode') {
    setServerProperties(dir, { 'online-mode': 'true' })
  } else {
    setServerProperties(dir, { 'white-list': 'true', 'enforce-whitelist': 'true' })
  }
  return checkShareSafety(dir, type)
}
