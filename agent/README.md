# ZeroPR Agent

Go daemon that handles peer discovery and WebSocket relay for ZeroPR sessions.

## What It Does

- Registers a `_zeropr._tcp` mDNS service so other ZeroPR instances can find you
- Browses the local network for other ZeroPR agents
- Manages session lifecycle (create, join, leave, end)
- Relays WebSocket messages between host and guest

## Build and Run

```sh
go run .
```

Or build a binary:

```sh
go build -o zeropr-agent .
./zeropr-agent
```

Listens on port 9080.

## API

### Discovery

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api` | Health check |
| GET | `/api/peers` | List discovered peers |
| POST | `/api/broadcast/start` | Start mDNS discovery |
| POST | `/api/broadcast/stop` | Stop mDNS and clear peers |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/session/create` | Create a new session |
| POST | `/api/session/join` | Join a session (called on guest's agent) |
| POST | `/api/session/leave` | Leave a session |
| POST | `/api/session/end` | End a session and close connections |
| GET | `/api/sessions` | List all sessions |

### WebSocket

| Path | Description |
|------|-------------|
| `/ws/session/{id}` | Bidirectional relay. First message must be JSON: `{"id": "...", "role": "Host" or "Guest", "host": "..."}` |

The relay forwards messages as-is between host and guest. It does not inspect or modify Yjs sync messages.

## Dependencies

- [gorilla/websocket](https://github.com/gorilla/websocket)
- [brutella/dnssd](https://github.com/brutella/dnssd)
- [google/uuid](https://github.com/google/uuid)
