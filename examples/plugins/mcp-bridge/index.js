// MCP Bridge — exposes Birdflop Server Manager to MCP clients (Claude Code,
// Claude Desktop, or any Model Context Protocol client) as a Streamable HTTP
// server on localhost. Zero dependencies: the MCP surface used here is plain
// JSON-RPC over HTTP POST.
//
// Connect with: http://127.0.0.1:8917/mcp  (port configurable, see README)

'use strict'

const http = require('node:http')

const PROTOCOL_VERSION = '2025-06-18'
const DEFAULT_PORT = 8917

/** @type {import('http').Server | null} */
let server = null

const TOOLS = [
  {
    name: 'list_servers',
    description:
      'List all managed Minecraft servers with their id, name, software, version, port, and current status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'start_server',
    description: 'Start a server. Returns immediately; watch status or console for readiness.',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string', description: 'Server id or name' } },
      required: ['server'],
      additionalProperties: false
    }
  },
  {
    name: 'stop_server',
    description: 'Gracefully stop a running server.',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string', description: 'Server id or name' } },
      required: ['server'],
      additionalProperties: false
    }
  },
  {
    name: 'restart_server',
    description: 'Restart a server (stop, then start once it exits).',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string', description: 'Server id or name' } },
      required: ['server'],
      additionalProperties: false
    }
  },
  {
    name: 'send_command',
    description: 'Send a console command to a running server (e.g. "say hi", "whitelist add Player").',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        command: { type: 'string', description: 'The console command, without leading slash' }
      },
      required: ['server', 'command'],
      additionalProperties: false
    }
  },
  {
    name: 'read_console',
    description: 'Read the tail of a server\'s console output (plain text, ANSI colors stripped).',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        lines: { type: 'number', description: 'How many trailing lines to return (default 100)' }
      },
      required: ['server'],
      additionalProperties: false
    }
  },
  {
    name: 'get_performance',
    description: 'Latest TPS / MSPT sample for a running server (20 TPS = perfect, 50+ MSPT = overloaded).',
    inputSchema: {
      type: 'object',
      properties: { server: { type: 'string', description: 'Server id or name' } },
      required: ['server'],
      additionalProperties: false
    }
  }
]

/** Resolve a tool's `server` argument against ids first, then case-insensitive names. */
async function resolveServer(ctx, ref) {
  const servers = await ctx.servers.list()
  const byId = servers.find((s) => s.id === ref)
  if (byId) return byId
  const matches = servers.filter((s) => s.name.toLowerCase() === String(ref).toLowerCase())
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error(`Multiple servers are named "${ref}" — use the id instead.`)
  throw new Error(`No server matches "${ref}". Use list_servers to see what's available.`)
}

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

async function callTool(ctx, name, args) {
  switch (name) {
    case 'list_servers':
      return text(await ctx.servers.list())
    case 'start_server': {
      const s = await resolveServer(ctx, args.server)
      await ctx.servers.start(s.id)
      return text(`Starting "${s.name}" (${s.id}).`)
    }
    case 'stop_server': {
      const s = await resolveServer(ctx, args.server)
      await ctx.servers.stop(s.id)
      return text(`Stopping "${s.name}" (${s.id}).`)
    }
    case 'restart_server': {
      const s = await resolveServer(ctx, args.server)
      await ctx.servers.restart(s.id)
      return text(`Restarting "${s.name}" (${s.id}).`)
    }
    case 'send_command': {
      const s = await resolveServer(ctx, args.server)
      await ctx.servers.sendCommand(s.id, String(args.command))
      return text(`Sent "${args.command}" to "${s.name}".`)
    }
    case 'read_console': {
      const s = await resolveServer(ctx, args.server)
      const buffer = stripAnsi(await ctx.servers.readConsole(s.id))
      const lines = buffer.split('\n')
      const n = Math.max(1, Math.min(Number(args.lines) || 100, 2000))
      return text(lines.slice(-n).join('\n') || '(console is empty)')
    }
    case 'get_performance': {
      const s = await resolveServer(ctx, args.server)
      const perf = await ctx.servers.getPerformance(s.id)
      if (!perf) return text(`No performance data for "${s.name}" (server stopped, still starting, or metrics unavailable).`)
      return text({ server: s.name, source: perf.source, tps: perf.tps, mspt: perf.mspt })
    }
    default:
      throw new Error(`Unknown tool "${name}"`)
  }
}

/** Handle one JSON-RPC message; returns a response object, or null for notifications. */
async function handleMessage(ctx, msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: (msg && msg.id) ?? null, error: { code: -32600, message: 'Invalid request' } }
  }
  const isNotification = msg.id === undefined || msg.id === null
  try {
    let result
    switch (msg.method) {
      case 'initialize':
        result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: {
            name: 'birdflop-server-manager',
            title: 'Birdflop Server Manager',
            version: ctx.app.version
          }
        }
        break
      case 'ping':
        result = {}
        break
      case 'tools/list':
        result = { tools: TOOLS }
        break
      case 'tools/call': {
        const { name, arguments: args } = msg.params || {}
        try {
          result = await callTool(ctx, name, args || {})
        } catch (err) {
          // Tool-level failures are results (isError), not protocol errors.
          result = { content: [{ type: 'text', text: String(err.message || err) }], isError: true }
        }
        break
      }
      default:
        if (msg.method.startsWith('notifications/')) return null
        if (isNotification) return null
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } }
    }
    return isNotification ? null : { jsonrpc: '2.0', id: msg.id, result }
  } catch (err) {
    if (isNotification) return null
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err.message || err) } }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 4 * 1024 * 1024) reject(new Error('Body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

module.exports = {
  async activate(ctx) {
    const port = (await ctx.storage.get('port')) || DEFAULT_PORT

    server = http.createServer((req, res) => {
      // Session teardown / SSE stream requests: acknowledge without a stream.
      if (req.method === 'DELETE') {
        res.writeHead(200).end()
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST, DELETE' }).end()
        return
      }
      void (async () => {
        let parsed
        try {
          parsed = JSON.parse(await readBody(req))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
          return
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed]
        const responses = []
        for (const m of messages) {
          const r = await handleMessage(ctx, m)
          if (r) responses.push(r)
        }
        if (responses.length === 0) {
          res.writeHead(202).end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(Array.isArray(parsed) ? responses : responses[0]))
      })().catch((err) => {
        ctx.log.error(`request failed: ${err.message}`)
        try {
          res.writeHead(500).end()
        } catch {
          /* response already started */
        }
      })
    })

    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    ctx.log.info(`MCP server listening on http://127.0.0.1:${port}/mcp`)
  },

  deactivate() {
    if (server) {
      server.close()
      server = null
    }
  }
}
