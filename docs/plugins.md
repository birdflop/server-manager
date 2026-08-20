# App plugins

Birdflop Server Manager can be extended with plugins — folders of JavaScript
dropped into the app's plugins directory. Plugins can watch and control
servers, add plugin/mod download sources, tunnel providers, server-software
providers, console macro buttons, and expose their own IPC to the renderer.

The [MCP bridge](../examples/plugins/mcp-bridge) is a complete worked example:
it lets Claude Code (or any MCP client) create, organize, and control your
servers over local HTTP.

## Anatomy

```
<userData>/plugins/
  my-plugin/
    plugin.json    # manifest
    index.js       # CommonJS entry
```

Open the folder from **Settings → Plugins → Folder**; **Reload** rescans it.

### plugin.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "One line about what it does.",
  "main": "index.js",
  "engines": { "bsm": ">=0.9.0" },
  "permissions": ["servers:read"],
  "isolation": "inline",
  "contributes": {
    "consoleMacros": [{ "label": "Day", "command": "time set day" }]
  }
}
```

- `id` — lowercase slug; used in IPC channel names, storage and log paths.
- `permissions` — what the plugin may touch; ungated calls throw. See the
  [SDK README](../sdk/README.md) for the list.
- `isolation` — `inline` (default) runs in the main process with full Node
  access; `process` runs in a separate Electron utility process talking to the
  app over RPC (same `ctx` API, except `tunnels.registerProvider`).
- `contributes.consoleMacros` — buttons added to every server's console while
  the plugin is active.

### Entry module

```js
/** @type {import('@birdflop/plugin-sdk').BirdflopPlugin} */
module.exports = {
  async activate(ctx) {
    ctx.log.info('hello')
    ctx.servers.onEvent((e) => {
      if (e.type === 'closed' && e.code !== 0) ctx.log.warn(`${e.id} crashed (${e.code})`)
    })
  },
  deactivate() {}
}
```

`activate(ctx)` runs at app start (and on enable/reload); it must finish within
10 seconds. Everything registered through `ctx` — event subscriptions, IPC
handlers, providers — is torn down automatically when the plugin is disabled,
reloaded, or the app quits; `deactivate()` is for things you opened yourself.

The full `ctx` API is documented by the type definitions in
[`sdk/index.d.ts`](../sdk/index.d.ts) (published as `@birdflop/plugin-sdk`).
The app-side source of truth is `src/main/plugins/api.ts` — keep the two in
sync when it changes.

## Capability tour

| ctx | You can |
| --- | --- |
| `servers` | list servers, read console scrollback, get TPS/MSPT, subscribe to output/status/exit events, start/stop/restart, send commands, create/delete/rename/move servers |
| `groups` | list, create, rename, and delete the sidebar groups servers are filed under |
| `storage` | persist JSON per plugin (`<userData>/plugin-data/<id>.json`) |
| `log` | write to `<userData>/plugin-logs/<id>.log` (viewable from Settings) |
| `ipc` | answer `window.api.invokePlugin(id, verb, …)` calls and broadcast to `window.api.onPluginEvent(id, event, cb)` listeners |
| `content.registerSource` | add a search+install source that appears in every server's Plugins/Mods → Browse tab |
| `tunnels.registerProvider` | add a way to share servers publicly (inline plugins only) |
| `software` | browse the install catalog (`listTypes`/`listVersions`/`listBuilds`) and register a server-software download provider |

## Trust model

Inline plugins execute arbitrary code in the app's main process — the same
trust level as running any server jar or npm package. The permissions in the
manifest gate the *curated* API and tell users what a plugin intends to do,
but they are not a sandbox. `"isolation": "process"` moves the plugin out of
the main process (a crash can't take the app down, and it only reaches the app
through the RPC bridge), but it still runs unsandboxed Node code with the
user's privileges. Only install plugins you trust.

## Internals (app developers)

- `src/main/plugins/host.ts` — scans, validates, activates, enables/disables.
- `src/main/plugins/context.ts` — builds the `ctx` facade; tracks every
  registration for clean teardown.
- `src/main/plugins/runner.ts` + `bootstrap.ts` — utilityProcess isolation:
  the real context stays in the main process; the child gets a proxy over the
  message channel (`rpc.ts` is the protocol).
- Providers plug into the open registries in `src/main/software`,
  `src/main/tunnels`, and `src/main/content`.
