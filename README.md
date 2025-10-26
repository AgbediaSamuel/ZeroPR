# ZeroPR

Local-first collaboration for developers on the same network. No cloud, no PRs, zero friction.

## What is ZeroPR?

ZeroPR enables developers on the same Wi-Fi/LAN to:
- See who's coding nearby and what files they're editing
- Share file changes instantly without git push/pull
- Co-edit files in real-time (Google Docs style)
- All encrypted, no cloud needed

Perfect for pair programming, hackathons, and co-located teams.

## Architecture

```
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│  VS Code Extension (TypeScript) │         │  VS Code Extension (TypeScript) │
│  ┌───────────────────────────┐  │         │  ┌───────────────────────────┐  │
│  │  Yjs CRDT Engine          │  │◄────────►│  │  Yjs CRDT Engine          │  │
│  │  UI + Editor Bindings     │  │   WS    │  │  UI + Editor Bindings     │  │
│  └──────────┬────────────────┘  │         │  └──────────┬────────────────┘  │
│             │ HTTP/IPC           │         │             │ HTTP/IPC           │
│  ┌──────────┴────────────────┐  │         │  ┌──────────┴────────────────┐  │
│  │  Go Agent (Daemon)        │  │◄────────►│  │  Go Agent (Daemon)        │  │
│  │  - mDNS Discovery         │  │  mDNS   │  │  - mDNS Discovery         │  │
│  │  - P2P Networking         │  │         │  │  - P2P Networking         │  │
│  │  - Session Management     │  │         │  │  - Session Management     │  │
│  └───────────────────────────┘  │         │  └───────────────────────────┘  │
└─────────────────────────────────┘         └─────────────────────────────────┘
```

## Features

### Discovery & Presence
- Automatic peer discovery via mDNS
- See who's editing what files
- Real-time status updates (editing/idle/away)
- Branch and file information

### File Sharing
- Request files from peers with one click
- Receive files directly into your workspace
- No git operations needed
- Preview before applying

### Real-Time Co-Editing
- Google Docs-style collaborative editing
- CRDT-based conflict resolution (Yjs)
- See cursors and edits in real-time
- Session-based collaboration

## Installation

### Prerequisites
- Go 1.21+
- Node.js 18+
- VS Code

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/zeropr.git
cd zeropr

# Install dependencies
npm install

# Build the Go agent
cd agent
go build -o bin/zeropr-agent ./cmd/agent
cd ..

# Build the VS Code extension
cd extension
npm run compile
cd ..
```

## Usage

### Start the Agent

```bash
cd agent
./bin/zeropr-agent
```

Options:
- `--http-port` - HTTP API port (default: 8080)
- `--ws-port` - WebSocket port (default: 9000)
- `--name` - Device name for discovery (default: zeropr-agent)

Example:
```bash
./bin/zeropr-agent --name="alice-laptop" --http-port=8080
```

### Install the Extension

1. Open `extension/` folder in VS Code
2. Press `F5` to launch Extension Development Host
3. The ZeroPR icon appears in the activity bar (left sidebar)

### Features in Action

#### View Nearby Peers
1. Click the ZeroPR icon in the sidebar
2. See list of discovered peers
3. View what files they're editing

#### Request a File
1. Click the download icon next to a peer
2. File is downloaded and opened in your workspace
3. Edit and commit when ready

#### Start Co-Editing
1. Open a file you want to collaborate on
2. Run command: `ZeroPR: Start Co-Editing`
3. Share the session ID with your peer
4. Both can edit simultaneously
5. Run `ZeroPR: Stop Co-Editing` when done

## Configuration

Extension settings (`.vscode/settings.json`):

```json
{
  "zeropr.agentPort": 8080,
  "zeropr.autoBroadcast": true,
  "zeropr.displayName": "Your Name",
  "zeropr.fileWhitelist": [".js", ".ts", ".py", ".go"]
}
```

## API Endpoints

The Go agent exposes these HTTP endpoints:

- `GET /api/peers` - List discovered peers
- `GET /api/status` - Agent status
- `POST /api/broadcast/start` - Start broadcasting presence
- `POST /api/broadcast/stop` - Stop broadcasting
- `POST /api/presence` - Update your presence
- `POST /api/file/request` - Request file from peer
- `POST /api/session/create` - Create co-editing session
- `POST /api/session/join` - Join existing session
- `POST /api/session/leave` - Leave session
- `GET /api/sessions` - List active sessions

WebSocket endpoint:
- `/ws/sync/{sessionId}` - Real-time Yjs sync

## Project Structure

```
zeropr/
├── agent/              # Go daemon
│   ├── cmd/agent/      # Main entry point
│   └── internal/       # Internal packages
│       ├── discovery/  # mDNS peer discovery
│       ├── peers/      # Peer registry
│       ├── server/     # HTTP/WebSocket server
│       └── sessions/   # Session management
├── extension/          # VS Code extension
│   └── src/
│       ├── extension.ts        # Main activation
│       ├── agentClient.ts      # HTTP client
│       ├── presenceManager.ts  # Presence broadcasting
│       ├── sessionManager.ts   # Co-editing with Yjs
│       └── ui/                 # UI components
└── shared/             # Shared TypeScript types
```

## Development

### Build Agent
```bash
cd agent
go build -o bin/zeropr-agent ./cmd/agent
```

### Build Extension
```bash
cd extension
npm run compile
# Or watch mode:
npm run watch
```

### Development Workflow
1. Start agent in terminal: `cd agent && ./bin/zeropr-agent`
2. Open extension in VS Code: `cd extension && code .`
3. Press F5 to launch Extension Development Host
4. Make changes, reload extension (Cmd+R in dev host)

## How It Works

### Discovery
1. Agent broadcasts presence via mDNS every 2 seconds
2. Other agents on the same network discover the broadcast
3. Peer information is stored in local registry
4. Extension polls agent for peer list

### File Sharing
1. Extension requests file from peer via agent
2. Agent forwards request to peer's agent
3. Peer's agent reads file from disk
4. File content is sent back through agents
5. Extension writes file to workspace

### Real-Time Co-Editing
1. Extension creates session via agent
2. Agent generates session ID and WebSocket URL
3. Both extensions connect to WebSocket
4. Yjs syncs text operations in real-time
5. Changes flow: Editor → Yjs → WebSocket → Peer's Yjs → Editor

## Security

- Local network only (no cloud)
- Pairing codes for first-time connections (planned)
- Encrypted WebSocket traffic (planned)
- Trust management (planned)

## Limitations

- Same network required (LAN/Wi-Fi)
- mDNS must not be blocked by firewall
- Currently no security implementation (WIP)
- Single file co-editing only

## Troubleshooting

### Agent won't start
- Check if ports 8080/9000 are in use: `lsof -i :8080`
- Kill conflicting processes
- Use different ports with flags

### Can't discover peers
- Ensure both machines are on same network
- Check firewall allows UDP port 5353 (mDNS)
- Corporate networks may block mDNS - use home network

### Extension errors
- Verify agent is running: `curl http://localhost:8080/api/status`
- Check extension settings for correct port
- Look at VS Code Debug Console for errors

## License

MIT

## Contributing

This is a side project, but contributions are welcome! Please:
- Keep changes focused
- Test locally before submitting
- Follow existing code style
- Update README if needed
