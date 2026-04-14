# ZeroPR

Real-time collaborative code editing over the local network. No server, no accounts, no pull requests.

## What is this?

ZeroPR lets two developers edit the same file simultaneously from their own VS Code instances. It discovers peers on the local network via mDNS, connects them over WebSocket, and syncs edits in real time using Yjs CRDTs. All traffic stays on your LAN.

## Features

- **Zero-config peer discovery** - finds collaborators on your network automatically via mDNS
- **Real-time sync** - conflict-free edits using Yjs CRDTs, no merge conflicts
- **Cursor presence** - see your collaborator's cursor and selections live
- **Virtual filesystem** - edits happen in a sandboxed `zeropr://` document, original files are untouched until you explicitly save
- **Multi-file sessions** - host can add multiple files to a single session
- **Per-user undo/redo** - undo history that doesn't clobber your collaborator's changes

## Architecture

```
┌──────────────┐         mDNS         ┌──────────────┐
│  VS Code +   │◄────────────────────►│  VS Code +   │
│  Extension   │                      │  Extension   │
│  (Yjs CRDT)  │                      │  (Yjs CRDT)  │
└──────┬───────┘                      └──────┬───────┘
       │ HTTP + WebSocket                    │ HTTP + WebSocket
┌──────┴───────┐        relay         ┌──────┴───────┐
│   Agent      │◄────────────────────►│   Agent      │
│   (Go)       │     WebSocket        │   (Go)       │
└──────────────┘                      └──────────────┘
```

Each machine runs a Go agent that handles discovery and message relay. The VS Code extension manages the Yjs document, binds it to the editor, and renders remote cursors.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Agent | Go, gorilla/websocket, brutella/dnssd |
| Extension | TypeScript, VS Code Extension API |
| Sync | Yjs, y-protocols, lib0 |
| Transport | WebSocket (binary) |
| Discovery | mDNS/DNS-SD (`_zeropr._tcp`) |

## Quick Start

**Prerequisites:** Go 1.25+, Node.js 18+, pnpm, VS Code 1.109+

**1. Start the agent**

```sh
cd agent
go run .
```

**2. Run the extension**

```sh
cd extension/zeropr
pnpm install
```

Open `extension/zeropr` in VS Code and press F5.

**3. Collaborate**

1. Click the ZeroPR icon in the activity bar
2. Click Start Search to discover peers
3. Open a file, click the + icon next to a peer to invite them
4. The peer joins from their Sessions panel

Both users see a `[ZeroPR]` tab with live-synced content. Original files are never modified unless you choose Save when ending the session.

## Project Structure

```
agent/                  Go agent (discovery, HTTP API, WebSocket relay)
extension/zeropr/       VS Code extension (Yjs sync, virtual filesystem, cursor presence)
docs/                   Documentation
```

## Testing

```sh
# Extension (383 tests across 8 suites)
cd extension/zeropr
pnpm install
tsx test/run-all.ts

# Agent (24 tests)
cd agent
go test ./...
```

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run the tests
5. Open a pull request

## License

MIT
