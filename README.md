# agent-client-protocol

An exploration of integrating a chat harness with the Agent Client Protocol.

## Static chat harness prototypes

This repository includes three static chat harness pages, opened directly in a browser with no build step:

- `copilot.html` — a pink harness for the [GitHub Copilot SDK](https://github.com/github/copilot-sdk).
- `acp.html` — a blue harness for the [Agent Client Protocol](https://agentclientprotocol.com).
- `comparison.html` — a neutral page comparing the two approaches.

Open `index.html` in a browser and choose a variant. Each chat page includes a model picker, a session type selector (Agent, Plan, Ask), a user prompt box, and a chat session history window.

## Real integrations, via a local bridge

Both the Copilot SDK and ACP are Node-only, stdio-oriented libraries — neither is meant to run directly in a browser. So `copilot.html` and `acp.html` each connect over WebSocket to a small local Node "bridge" process in [`server/`](./server), which is the only place either SDK is actually imported:

- `server/copilot-bridge.mjs` — spawns a `CopilotClient` session and relays it to `copilot.html` at `ws://127.0.0.1:8787/copilot`.
- `server/acp-bridge.mjs` — spawns an ACP-compliant agent process you configure and relays it to `acp.html` at `ws://127.0.0.1:8788/acp`, including surfacing the agent's permission requests to the browser for explicit approve/deny.

Neither bridge binds beyond `127.0.0.1`, and no secrets are ever committed to this repo — Copilot auth lives in your locally installed `copilot` CLI's own login, and any ACP agent secrets go in a gitignored `server/.env` (copy `.env.example` to get started). If a bridge isn't running, its page shows a clear "not connected" banner instead of silently failing — the static pages are always safe to open on their own.

To try it locally:

```sh
cd server
npm install
cp ../.env.example .env   # edit as needed, especially ACP_AGENT_COMMAND
node copilot-bridge.mjs   # in one terminal
node acp-bridge.mjs       # in another terminal
```

Then open `index.html` and try either variant. See [COPILOT-SDK-INTEGRATION.md](./COPILOT-SDK-INTEGRATION.md) and [ACP-INTEGRATION.md](./ACP-INTEGRATION.md) for the full design and setup details, and [COMPARISON.md](./COMPARISON.md) (or `comparison.html`) for how the two approaches differ.

