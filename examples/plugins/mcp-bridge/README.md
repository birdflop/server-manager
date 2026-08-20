# MCP Bridge

Exposes Birdflop Server Manager to [Model Context Protocol](https://modelcontextprotocol.io)
clients — Claude Code, Claude Desktop, or anything else that speaks MCP — so an
AI agent can create, organize, start/stop, and inspect your test servers.

## Install

Copy this folder into the app's plugins directory (Settings → Plugins →
**Folder**), then hit **Reload**. The plugin log shows the listen address.

## Connect

The bridge speaks Streamable HTTP on `http://127.0.0.1:8917/mcp`. For Claude Code:

```
claude mcp add --transport http birdflop http://127.0.0.1:8917/mcp
```

## Tools

**Servers**

| Tool | What it does |
| --- | --- |
| `list_servers` | ids, names, software, versions, status, group |
| `start_server` / `stop_server` / `restart_server` | lifecycle control |
| `send_command` | run a console command |
| `read_console` | tail the console (ANSI stripped) |
| `get_performance` | latest TPS / MSPT sample |
| `create_server` | download + install a new server |
| `delete_server` | delete a server and its folder (needs `confirm: true`) |
| `rename_server` / `move_server` | rename, or file into a group |

**Groups**

| Tool | What it does |
| --- | --- |
| `list_groups` | ids, names, and member servers |
| `create_group` / `rename_group` / `delete_group` | manage sidebar groups |

**Catalog** — `list_software`, `list_versions`, `list_builds` back the choices
`create_server` accepts.

Tools accept a server or group **id or name**.

### Creating servers

Only `name` and `software` are required:

```
create_server { "name": "perms test", "software": "paper" }
```

Everything else is filled in for you — newest Minecraft version and build, the
first free port from 25565, the app's default heap size, and a Java runtime
matching the version (downloaded if the machine has none that fits). Pass
`mc_version`, `build`, `port`, `ram_mb`, `java_path`, `jvm_args`, or `group` to
pin any of them.

The Minecraft EULA is **not** accepted by default, so a fresh server refuses to
start until someone passes `accept_eula: true` — that's a decision for the user,
not the agent. Proxies (Velocity, Waterfall, BungeeCord) have no EULA and start
straight away.

## Changing the port

The port lives in the plugin's storage file
(`<userData>/plugin-data/mcp-bridge.json`):

```json
{ "port": 9000 }
```

Disable + re-enable the plugin to apply.

## Security

The bridge binds to `127.0.0.1` only and has no authentication — anything
running on your machine can reach it. It can create and **delete** servers, run
console commands, and start/stop processes, so don't port-forward it. If you
only want read-only access, drop `servers:manage` (and `servers:control`) from
`plugin.json` — the matching tools then fail with a permission error instead.
