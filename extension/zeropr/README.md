# ZeroPR Extension

VS Code extension for real-time collaborative editing over the local network.

## What It Does

- Discovers peers and displays them in the sidebar
- Creates and joins collaborative editing sessions
- Syncs document changes in real time using Yjs CRDTs
- Shows remote cursor positions and selections
- Per-user undo/redo that doesn't affect your collaborator
- Sandboxes all edits in a virtual `zeropr://` filesystem

## Build and Run

```sh
pnpm install
```

Open this folder in VS Code and press F5 to launch the Extension Development Host.

Build without launching:

```sh
pnpm run compile
```

## Commands

| Command | Description |
|---------|-------------|
| Start Search | Begin mDNS peer discovery |
| Stop Search | Stop discovery and clear peers |
| Invite to Session | Create a session and invite a peer |
| Join Session | Join an incoming session |
| Leave Session | Leave as guest |
| End Session | End as host (prompts to save) |
| Add File to Session | Add another file (host only) |
| Refresh Peers | Refresh the peers list |
| Refresh Sessions | Refresh the sessions list |

Undo/Redo (Cmd+Z / Cmd+Shift+Z) is automatically overridden in `zeropr://` files to use per-user undo history.

## Testing

```sh
tsx test/run-all.ts
```

8 suites, 359 tests: sync, binding, awareness, multifile, agent, edge-cases, stress, endurance.

## Dependencies

- [yjs](https://github.com/yjs/yjs)
- [y-protocols](https://github.com/yjs/y-protocols)
- [lib0](https://github.com/dmonad/lib0)
