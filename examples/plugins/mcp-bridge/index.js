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

/** Proxies have no Minecraft EULA, so a fresh one starts fine without accepting it. */
const PROXIES = new Set(['velocity', 'waterfall', 'bungeecord'])

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
  },
  {
    name: 'list_software',
    description:
      'List the server software the app can install (paper, fabric, velocity, …). Use before create_server.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_versions',
    description: 'Minecraft versions available for a server software, newest first.',
    inputSchema: {
      type: 'object',
      properties: { software: { type: 'string', description: 'Software id from list_software' } },
      required: ['software'],
      additionalProperties: false
    }
  },
  {
    name: 'list_builds',
    description: 'Builds available for a software + Minecraft version, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        software: { type: 'string', description: 'Software id from list_software' },
        mc_version: { type: 'string', description: 'Minecraft version, e.g. "1.21.4"' }
      },
      required: ['software', 'mc_version'],
      additionalProperties: false
    }
  },
  {
    name: 'create_server',
    description:
      'Create and install a new server. Only name and software are required — the newest version ' +
      'and build, a free port, the default RAM, and a matching Java runtime are chosen automatically ' +
      '(Java is downloaded if none fits). Takes a while: it downloads the server jar.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the new server' },
        software: { type: 'string', description: 'Software id from list_software, e.g. "paper"' },
        mc_version: { type: 'string', description: 'Minecraft version (default: newest available)' },
        build: { type: 'string', description: 'Build id from list_builds (default: newest)' },
        port: { type: 'number', description: 'Bind port (default: first free port from 25565)' },
        ram_mb: { type: 'number', description: 'Heap size in MB (default: the app\'s configured default)' },
        java_path: { type: 'string', description: 'Java executable (default: auto-picked for the version)' },
        jvm_args: { type: 'array', items: { type: 'string' }, description: 'Extra JVM flags' },
        group: { type: 'string', description: 'Group id or name to file it under' },
        accept_eula: {
          type: 'boolean',
          description:
            'Accept the Minecraft EULA. Only set true if the user has actually agreed — a server ' +
            'without it refuses to start.'
        }
      },
      required: ['name', 'software'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_server',
    description:
      'Delete a server: stops it, then removes its folder (a server kept in an external folder ' +
      'is only unlinked). Destructive — confirm with the user first.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        confirm: { type: 'boolean', description: 'Must be true; guards against accidental deletion' }
      },
      required: ['server', 'confirm'],
      additionalProperties: false
    }
  },
  {
    name: 'rename_server',
    description: 'Rename a server (its folder and id are unchanged).',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        name: { type: 'string', description: 'The new name' }
      },
      required: ['server', 'name'],
      additionalProperties: false
    }
  },
  {
    name: 'move_server',
    description: 'Move a server into a group, or out of every group when `group` is omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name' },
        group: { type: 'string', description: 'Group id or name; omit to make it ungrouped' }
      },
      required: ['server'],
      additionalProperties: false
    }
  },
  {
    name: 'list_groups',
    description: 'List the sidebar groups with their ids, names, and the servers in each.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'create_group',
    description: 'Create a sidebar group to organize servers into.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name for the new group' } },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'rename_group',
    description: 'Rename a group.',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Group id or name' },
        name: { type: 'string', description: 'The new name' }
      },
      required: ['group', 'name'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_group',
    description: 'Delete a group. Its servers are kept — they just become ungrouped.',
    inputSchema: {
      type: 'object',
      properties: { group: { type: 'string', description: 'Group id or name' } },
      required: ['group'],
      additionalProperties: false
    }
  }
]

/** Resolve a `ref` against ids first, then case-insensitive names, over any id+name list. */
function resolveRef(items, ref, kind, listTool) {
  const byId = items.find((i) => i.id === ref)
  if (byId) return byId
  const matches = items.filter((i) => i.name.toLowerCase() === String(ref).toLowerCase())
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error(`Multiple ${kind}s are named "${ref}" — use the id instead.`)
  throw new Error(`No ${kind} matches "${ref}". Use ${listTool} to see what's available.`)
}

async function resolveServer(ctx, ref) {
  return resolveRef(await ctx.servers.list(), ref, 'server', 'list_servers')
}

async function resolveGroup(ctx, ref) {
  return resolveRef(await ctx.groups.list(), ref, 'group', 'list_groups')
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

    case 'list_software':
      return text(await ctx.software.listTypes())
    case 'list_versions':
      return text(await ctx.software.listVersions(String(args.software)))
    case 'list_builds':
      return text(await ctx.software.listBuilds(String(args.software), String(args.mc_version)))

    case 'create_server': {
      const group = args.group ? await resolveGroup(ctx, args.group) : null
      const created = await ctx.servers.create({
        name: String(args.name),
        serverType: String(args.software),
        mcVersion: args.mc_version ? String(args.mc_version) : undefined,
        build: args.build ? String(args.build) : undefined,
        port: args.port !== undefined ? Number(args.port) : undefined,
        ramMB: args.ram_mb !== undefined ? Number(args.ram_mb) : undefined,
        javaPath: args.java_path ? String(args.java_path) : undefined,
        jvmArgs: Array.isArray(args.jvm_args) ? args.jvm_args.map(String) : undefined,
        eulaAccepted: args.accept_eula === true,
        groupId: group ? group.id : null
      })
      const needsEula = !PROXIES.has(created.serverType) && args.accept_eula !== true
      return text(
        `Created "${created.name}" (${created.id}): ${created.serverType} ${created.mcVersion} on port ${created.port}.` +
          (needsEula
            ? ' The EULA is not accepted yet, so it will refuse to start — ask the user before accepting it.'
            : '')
      )
    }
    case 'delete_server': {
      if (args.confirm !== true) throw new Error('Refusing to delete without confirm: true.')
      const s = await resolveServer(ctx, args.server)
      await ctx.servers.delete(s.id)
      return text(`Deleted "${s.name}" (${s.id}).`)
    }
    case 'rename_server': {
      const s = await resolveServer(ctx, args.server)
      await ctx.servers.rename(s.id, String(args.name))
      return text(`Renamed "${s.name}" to "${args.name}".`)
    }
    case 'move_server': {
      const s = await resolveServer(ctx, args.server)
      const group = args.group ? await resolveGroup(ctx, args.group) : null
      await ctx.servers.move(s.id, group ? group.id : null)
      return text(group ? `Moved "${s.name}" into "${group.name}".` : `Moved "${s.name}" out of its group.`)
    }

    case 'list_groups':
      return text(await ctx.groups.list())
    case 'create_group': {
      const group = await ctx.groups.create(String(args.name))
      return text(`Created group "${group.name}" (${group.id}).`)
    }
    case 'rename_group': {
      const group = await resolveGroup(ctx, args.group)
      await ctx.groups.rename(group.id, String(args.name))
      return text(`Renamed group "${group.name}" to "${args.name}".`)
    }
    case 'delete_group': {
      const group = await resolveGroup(ctx, args.group)
      await ctx.groups.delete(group.id)
      return text(`Deleted group "${group.name}". Its ${group.serverIds.length} server(s) are now ungrouped.`)
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
