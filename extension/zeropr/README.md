# ZeroPR

Real-time collaborative editing over your local network. No cloud, no account, no internet — just be on the same Wi-Fi.

## Features

- **Peer discovery** over mDNS — people on your network show up in the sidebar automatically
- **Live co-editing** powered by Yjs CRDTs — both sides can type at once and stay in sync
- **Remote cursors and selections** so you can see where your collaborator is working
- **Per-user undo/redo** — Cmd+Z only undoes *your* edits, not theirs
- **Sandboxed edits** in a virtual `zeropr://` filesystem — your original files stay untouched until you save

## Getting Started

1. Open the **ZeroPR** sidebar from the Activity Bar.
2. Click **Start Search** — nearby peers running ZeroPR will appear.
3. Right-click a peer and choose **Invite to Session**, or accept an incoming invite under **Sessions**.
4. Edit together. When you're done, the host ends the session and chooses whether to save.

## Commands

| Command | Description |
|---------|-------------|
| Start Search | Begin discovering peers on your network |
| Stop Search | Stop discovery and clear the peers list |
| Invite to Session | Create a session and invite a peer |
| Join Session | Join an incoming session |
| Add File to Session | Share another file with your collaborator (host only) |
| Leave Session | Leave the session as a guest |
| End Session | End the session as host (prompts to save) |

Cmd+Z / Cmd+Shift+Z are automatically rerouted inside `zeropr://` files so your undo history is independent from your collaborator's.

## Requirements

Both participants must be on the same local network and have the ZeroPR extension installed. No sign-in or internet connection is needed.
