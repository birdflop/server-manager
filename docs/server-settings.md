# Server settings

Every server has a **Settings** tab (and a related **Properties** tab) where you tune how it runs. This page explains each option.

> Most runtime options take effect on the next launch. When a server is running, the Settings tab shows a **“Restart to apply”** hint next to anything that needs a restart.

## Contents

- [Server information](#server-information)
- [Runtime settings](#runtime-settings)
- [File watcher](#file-watcher)
- [Remote debugging (JDWP)](#remote-debugging-jdwp)
- [server.properties editor](#serverproperties-editor)
- [Danger zone](#danger-zone)

---

## Server information

Read-only details about the instance, plus two actions:

- **Software / Minecraft / Build / Created** — what this server is and when it was made.
- **Open folder** — reveal the server's folder in your OS file manager.
- **Save as template** — store this server's software, version, build, memory, and JVM args as a reusable preset that appears in the create-instance wizard.
- **Duplicate** — make a full copy of the server (files included) with a new id and a bumped port.

---

## Runtime settings

These control how the server process is launched.

| Setting | What it does |
| --- | --- |
| **Server name** | Display name in the sidebar, tabs, and dashboard. Doesn't change the folder on disk. |
| **Port** | The port the server binds to. Kept in sync with `server-port` in `server.properties` (or the proxy config for proxies). |
| **Memory** | Heap size. Sets both `-Xmx` and `-Xms` to the same value (e.g. 2 GB → `-Xmx2048M -Xms2048M`). |
| **Java installation** | Which detected/managed JDK or JRE runs this server. Use the ⟳ button to rescan for newly installed Java. The app downloads a matching Temurin runtime automatically when a server needs one you don't have. |
| **Extra JVM arguments** | Space-separated flags appended to the launch command, e.g. `-XX:+UseG1GC`. Leave blank for defaults. |

Click **Save changes** to persist. Changes apply the next time the server starts.

---

## File watcher

Automatically react when watched files change — ideal for the plugin/mod development loop (rebuild your jar, drop it in, server reloads itself). The watcher **only acts while the server is running**.

| Setting | What it does |
| --- | --- |
| **Enabled** | Turns the watcher on. Enabling it on a server with a content folder pre-fills sensible defaults (watch the `plugins`/`mods` folder, react to `.jar` files). |
| **Watched paths** | One path per line, relative to the server folder, e.g. `plugins` or `server.properties`. Folders are watched recursively. |
| **File extensions** | For watched *folders* only: react only to files with these extensions (e.g. `jar`). Blank = any file. Ignored for directly-watched files. |
| **On change** | **Restart the server**, or **Run a console command** (e.g. `reload confirm`). |
| **Console command** | The command to send when the action is "Run a console command". |
| **Debounce (ms)** | How long to wait after the last change before acting. Prevents a half-written jar from triggering a restart. Minimum 100 ms. |

---

## Remote debugging (JDWP)

Launches the server with a JDWP agent so you can attach a debugger (IntelliJ IDEA / VS Code) and set breakpoints in your plugin or mod. **Restart the server after changing these options.**

| Setting | What it does |
| --- | --- |
| **Enabled** | Adds the `-agentlib:jdwp` flag to the launch command. |
| **Debug port** | TCP port the debugger connects to (default `5005`). |
| **Suspend until attached** | When on, the JVM pauses at startup until a debugger attaches — use this only to debug very early init (e.g. plugin `onEnable`). Leave off for normal use so the server boots without waiting. |

When enabled, the server header shows a `debug :<port>` badge, and the Settings panel has a **Copy** button that copies `localhost:<port>` for pasting into your IDE.

Under the hood the server is launched with:

```
-agentlib:jdwp=transport=dt_socket,server=y,suspend=<y|n>,address=*:<port>
```

### Attach from VS Code

1. Install the **Extension Pack for Java** (or at least **Debugger for Java**) and open your plugin/mod project.
2. Create `.vscode/launch.json`:

   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "type": "java",
         "name": "Attach to Minecraft server",
         "request": "attach",
         "hostName": "localhost",
         "port": 5005
       }
     ]
   }
   ```
3. Start the server, then open **Run and Debug** (Ctrl+Shift+D), pick **Attach to Minecraft server**, and press **F5**.

### Attach from IntelliJ IDEA

1. **Run → Edit Configurations → + → Remote JVM Debug**.
2. Set **Host** to `localhost` and **Port** to `5005` (match the app). Debugger mode: **Attach to remote JVM**.
3. Start the server, then run this configuration (the green debug bug).

### Tips

- **Build with debug info.** Compile your jar with line numbers and variables (the Maven/Gradle default). If debug info is stripped, breakpoints won't bind.
- **Port must match** the value in Settings. For a server on another machine, use its IP/hostname instead of `localhost`.
- **Hot-reload loop:** pair this with the **File watcher** (restart on jar change). After a restart the debug session drops — just re-attach. Small method-body edits can be applied live via your IDE's hot-swap without a restart; structural changes need a rebuild + restart.

---

## server.properties editor

The **Properties** tab (shown for all non-proxy servers) is a friendly editor over the server's `server.properties` file. Common keys are grouped into **Gameplay**, **Players**, **World**, and **Performance**, with toggles, dropdowns, and number fields. Any keys not in the curated set appear under **Other properties** as raw editable values.

- The **port** is intentionally not editable here — set it on the **Settings** tab so it stays in sync with the instance config.
- Changes are written to `server.properties`; **restart the server to apply** them.

---

## Danger zone

**Delete server** permanently removes the server and all of its files from disk. This cannot be undone. You'll be asked to confirm first.
