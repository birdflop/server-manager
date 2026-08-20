# @birdflop/plugin-sdk

Type definitions for building [Birdflop Server Manager](https://github.com/birdflop/server-manager) plugins.

## What's a plugin?

A folder dropped into the app's plugins directory (Settings → Plugins → Folder):

```
my-plugin/
  plugin.json    # manifest
  index.js       # CommonJS entry
```

**plugin.json**

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Does something useful.",
  "main": "index.js",
  "permissions": ["servers:read", "servers:control"]
}
```

**index.js**

```js
/** @type {import('@birdflop/plugin-sdk').BirdflopPlugin} */
module.exports = {
  async activate(ctx) {
    ctx.log.info('activated!')
    const servers = await ctx.servers.list()
    ctx.servers.onEvent((e) => {
      if (e.type === 'status') ctx.log.info(`${e.id} is now ${e.status}`)
    })
  },
  deactivate() {
    // Registrations (events, IPC, providers) are cleaned up automatically;
    // close anything you opened yourself here (sockets, timers, …).
  }
}
```

Install this package as a dev dependency for autocomplete:

```
npm i -D @birdflop/plugin-sdk
```

## Permissions

Declare what you use in `plugin.json`; calls without the matching permission throw.

| Permission | Grants |
| --- | --- |
| `servers:read` | list/status/console/performance + server events, group list, software catalog |
| `servers:control` | start/stop/restart/sendCommand |
| `servers:manage` | create/delete/rename/move servers, create/rename/delete groups |
| `content:sources` | register a plugin/mod search+install source |
| `tunnels:providers` | register a tunnel provider (inline plugins only) |
| `software:providers` | register a server-software provider |
| `network:listen` | informational: the plugin opens a local port |

## Isolation

By default plugins run **inline** in the app's main process — full Node access,
same trust model as installing any npm package. Set `"isolation": "process"` in
the manifest to run in a separate utility process instead; the `ctx` API is
identical (bridged over RPC), except `tunnels.registerProvider`, which needs
live callbacks and is inline-only.

## Notes

- Plugins run with the user's privileges. Only install plugins you trust.
- Logs land in the app's `plugin-logs/<id>.log` (Settings → Plugins → file icon).
- The app cleans up everything you registered through `ctx` when the plugin is
  disabled, reloaded, or the app quits.
