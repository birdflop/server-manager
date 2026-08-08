# MCP Bridge

Exposes Birdflop Server Manager to [Model Context Protocol](https://modelcontextprotocol.io)
clients — Claude Code, Claude Desktop, or anything else that speaks MCP — so an
AI agent can start/stop your test servers, send console commands, read logs,
and check TPS.

## Install

Copy this folder into the app's plugins directory (Settings → Plugins →
**Folder**), then hit **Reload**. The plugin log shows the listen address.

## Connect

The bridge speaks Streamable HTTP on `http://127.0.0.1:8917/mcp`. For Claude Code:

```
claude mcp add --transport http birdflop http://127.0.0.1:8917/mcp
```

## Tools

| Tool | What it does |
| --- | --- |
| `list_servers` | ids, names, software, versions, status |
| `start_server` / `stop_server` / `restart_server` | lifecycle control |
| `send_command` | run a console command |
| `read_console` | tail the console (ANSI stripped) |
| `get_performance` | latest TPS / MSPT sample |

Tools accept a server **id or name**.

## Changing the port

The port lives in the plugin's storage file
(`<userData>/plugin-data/mcp-bridge.json`):

```json
{ "port": 9000 }
```

Disable + re-enable the plugin to apply.

## Security

The bridge binds to `127.0.0.1` only and has no authentication — anything
running on your machine can reach it. It can start/stop servers and run console
commands, so don't port-forward it.
