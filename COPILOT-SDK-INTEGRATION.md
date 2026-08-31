# Plan: Wiring `copilot.html` to the GitHub Copilot SDK

## Goal

Replace the local-echo behavior on [copilot.html](/c:/Users/fmigacz/Code/agent-client-protocol/agent-client-protocol/copilot.html) with a real chat session backed by the [`@github/copilot-sdk`](https://github.com/github/copilot-sdk) (Node.js 20+, spawns the `copilot` CLI and speaks a local JSON-RPC-like protocol over stdio). The SDK is **Node-only** — it is not designed to run inside a browser sandbox — so the browser page must talk to a small local bridge process rather than importing the SDK directly.

This document describes the target architecture, the exact files to add, and the manual steps the repo owner must take. No code in this plan is implemented yet; it is a design for a follow-up change.

## Why a bridge server is required

`@github/copilot-sdk` spawns and manages a local `copilot` CLI subprocess and communicates over stdio. Browsers cannot spawn processes or open stdio pipes, so `copilot.html` cannot import the SDK directly via `<script type="module">`. The standard pattern (and the one GitHub's own docs/browser-extension reference implementation use) is:

```
copilot.html (browser)  <-- WebSocket/HTTP -->  local bridge server (Node)  <-- stdio -->  copilot CLI (via SDK)
```

The bridge is a small, auditable Node script that runs only on the developer's own machine, started explicitly by the repo owner — never auto-started, never deployed.

## Proposed new files

1. **`server/copilot-bridge.mjs`** (new)
   - A minimal Node HTTP + WebSocket server (e.g. using the built-in `node:http` and the `ws` package, or `node:http` + Server-Sent Events to avoid an extra dependency).
   - Responsibilities:
     - On startup, construct `new CopilotClient({ logLevel: "error" })` and `await client.start()`.
     - Expose one WebSocket endpoint, e.g. `ws://localhost:8787/copilot`.
     - On each browser connection: `await client.createSession({ systemMessage: { mode: "append", content: "..." } })`.
     - Relay `session.on("assistant.message", ...)` events to the browser as JSON frames `{ type: "assistant", text, meta }`.
     - Relay incoming browser frames `{ type: "prompt", text, model, sessionType }` into `session.send({ prompt: text })`.
     - On socket close: `await session.disconnect()`.
     - On process exit (`SIGINT`/`SIGTERM`): `await client.stop()`.
   - Reads the GitHub auth token **only from an environment variable** (see Authentication below) — never hardcoded, never logged, never sent to the browser.
   - Binds to `127.0.0.1` only (not `0.0.0.0`), so it is not reachable from other machines on the network.

2. **`server/package.json`** (new)
   - Declares `@github/copilot-sdk` and `ws` as dependencies, isolated from the static site so the root of the repo stays dependency-free for anyone who just wants to open the HTML files.

3. **`copilot.js`** (new, replaces the echo logic currently shared via [app.js](/c:/Users/fmigacz/Code/agent-client-protocol/agent-client-protocol/app.js) for this page only)
   - Opens `new WebSocket("ws://localhost:8787/copilot")` when the page loads.
   - Reuses the existing form/history DOM wiring from `app.js`, but instead of calling `appendMessage('Echo', ...)` synchronously, it sends the prompt over the socket and appends a message when the bridge relays back an `assistant` frame.
   - Shows a clear "Bridge not running" banner (with a link to this doc) if the WebSocket fails to connect, so the page degrades gracefully back to being a harmless static page instead of hanging.
   - Never embeds a token, key, or endpoint URL other than `localhost`.

4. **`copilot.html`** (edit)
   - Swap `<script src="app.js" defer>` for `<script src="copilot.js" defer>` on this page only (`acp.html` keeps using `app.js`/its own script, so the two variants stay independently testable).
   - Add a small `<p class="bridge-status" data-bridge-status>` element for the connect/disconnect banner described above.
   - Keep the existing model/session-type selectors; pass their values through to the bridge as metadata only (the SDK session itself decides which underlying model/mode to use — the current dropdowns are cosmetic until the bridge maps them to real SDK options).

5. **`.env.example`** (new, at repo root or in `server/`)
   - Documents the one required variable, e.g. `COPILOT_SDK_LOG_LEVEL=error`, and notes that auth is handled by the `copilot` CLI's own login flow, not by an env var containing a secret (see below).

6. **`.gitignore`** (edit)
   - Add `server/node_modules/`, `server/.env`, and any `*.log` bridge output so nothing sensitive or heavy is ever committed.

## Authentication (safety-critical)

The Copilot SDK does **not** want a raw PAT baked into app code. The safe, supported flow is:

1. The repo owner installs the GitHub Copilot CLI locally and runs its own interactive login (`copilot auth login` or equivalent), which stores credentials in the CLI's own secure OS credential store — **not** in this repo.
2. The bridge server (`server/copilot-bridge.mjs`) simply spawns/uses that already-authenticated CLI via the SDK; it never reads, stores, or transmits a token itself.
3. Nothing related to authentication is ever written to a file inside this repository, committed to git, or sent to the browser page. The browser only ever talks to `localhost`.
4. If the CLI is not authenticated, `client.start()`/`createSession()` will fail; the bridge should catch that and return a clear, non-secret error message (`"copilot CLI is not authenticated — run `copilot auth login` and restart the bridge"`) to the browser banner.

## Steps the repo owner must perform

These steps are **manual, local, and opt-in** — nothing in the repo does this automatically:

1. Install Node.js 20+ if not already present.
2. Install the GitHub Copilot CLI and complete its interactive login (`copilot auth login`), separately from this repo.
3. `cd server && npm install` to pull down `@github/copilot-sdk` and `ws` (only inside `server/`, so the root site stays dependency-free).
4. `node server/copilot-bridge.mjs` to start the local bridge on `127.0.0.1:8787`.
5. Open `copilot.html` in a browser (still just a static file — no build step) and confirm the bridge-status banner shows "connected."
6. To stop, `Ctrl+C` the bridge process; the SDK client and CLI subprocess shut down cleanly.

## Safety notes

- The bridge only binds to `127.0.0.1`, so it is never reachable remotely.
- No secrets are stored in this repository at any point — auth lives entirely inside the locally installed Copilot CLI's own credential store.
- The bridge is a separate opt-in process; the static pages remain safe to open with no bridge running (they just show a "not connected" banner instead of silently failing).
- `server/` should be added to any CI/lint scope only for basic syntax checking — it must never run automatically in CI without credentials being present, and CI should not attempt to start the bridge.
