import { describe, expect, it } from 'vitest'
import { diagnoseTunnelError, parseTunnelEvent, pickLatestCompatible } from '../events'

describe('parseTunnelEvent', () => {
  it('parses each event kind', () => {
    expect(
      parseTunnelEvent('{"event":"identity_issued","subdomain":"a3k9zq","token":"t"}')
    ).toEqual({ event: 'identity_issued', subdomain: 'a3k9zq', token: 't' })

    expect(parseTunnelEvent('{"event":"bound","addresses":["a.tunnel.birdflop.com"]}')).toEqual({
      event: 'bound',
      addresses: ['a.tunnel.birdflop.com']
    })

    expect(
      parseTunnelEvent('{"event":"connected","reconnect":true,"addresses":[]}')
    ).toMatchObject({ event: 'connected', reconnect: true })

    expect(
      parseTunnelEvent(
        '{"event":"reconnecting","attempt":2,"delay_ms":2000,"error":"relay closed the connection"}'
      )
    ).toMatchObject({ event: 'reconnecting', attempt: 2 })

    const stats = parseTunnelEvent(
      '{"event":"stats","routes":[{"hostname":"a.tunnel.birdflop.com","port":25565,"active_connections":1,"total_connections":4,"bytes":512}]}'
    )
    expect(stats).toMatchObject({ event: 'stats' })
    if (stats?.event === 'stats') {
      expect(stats.routes[0].bytes).toBe(512)
    }

    expect(parseTunnelEvent('{"event":"error","message":"boom","fatal":true}')).toEqual({
      event: 'error',
      message: 'boom',
      fatal: true
    })
  })

  it('ignores noise, non-JSON, and unknown events', () => {
    expect(parseTunnelEvent('')).toBeNull()
    expect(parseTunnelEvent('BFTUNNEL_ADDRESS a.tunnel.birdflop.com')).toBeNull()
    expect(parseTunnelEvent('{"event":')).toBeNull()
    expect(parseTunnelEvent('{"event":"brand_new_thing","x":1}')).toBeNull()
    expect(parseTunnelEvent('{"no_event":true}')).toBeNull()
    expect(parseTunnelEvent('null')).toBeNull()
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseTunnelEvent('  {"event":"connected","reconnect":false,"addresses":[]}\r')).not.toBeNull()
  })
})

describe('diagnoseTunnelError', () => {
  it('maps known relay errors to actionable messages', () => {
    expect(diagnoseTunnelError('server error: registration rate limit exceeded')).toMatch(
      /rate-limiting/
    )
    expect(diagnoseTunnelError('authentication failed: unknown subdomain')).toMatch(
      /no longer exists/
    )
    expect(diagnoseTunnelError('authentication failed: invalid token')).toMatch(/rejected/)
    expect(diagnoseTunnelError('server error: address already in use: a.tunnel.birdflop.com')).toMatch(
      /another computer/
    )
    expect(diagnoseTunnelError('server error: too many tunnels for this identity (max 10)')).toMatch(
      /limit on simultaneous tunnels/
    )
    expect(diagnoseTunnelError('could not connect to tunnel.birdflop.com:7835')).toMatch(
      /Could not reach/
    )
    expect(diagnoseTunnelError('server error: port must be above 1000')).toMatch(/public port/)
  })

  it('passes unknown messages through untouched', () => {
    expect(diagnoseTunnelError('something novel happened')).toBe('something novel happened')
  })
})

describe('pickLatestCompatible', () => {
  it('picks the newest patch of the pinned minor', () => {
    expect(
      pickLatestCompatible(['v0.3.0', 'v0.3.2', 'v0.3.1', 'v0.4.0', 'v1.0.0'], 'v0.3.0')
    ).toBe('v0.3.2')
  })

  it('never crosses a minor/major boundary', () => {
    expect(pickLatestCompatible(['v0.4.0', 'v1.0.0'], 'v0.3.0')).toBe('v0.3.0')
  })

  it('never downgrades below the pin', () => {
    expect(pickLatestCompatible(['v0.3.0'], 'v0.3.1')).toBe('v0.3.1')
  })

  it('ignores garbage tags', () => {
    expect(pickLatestCompatible(['nightly', 'v0.3', 'v0.3.5-rc1', 'v0.3.4'], 'v0.3.0')).toBe(
      'v0.3.4'
    )
  })
})
