# Plan: Wiring `acp.html` to the Agent Client Protocol (ACP)

## Goal

Replace the local-echo behavior on [acp.html](/c:/Users/fmigacz/Code/agent-client-protocol/agent-client-protocol/acp.html) with a real session against an ACP-compliant agent, using the official [`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk) (the maintained successor to `@zed-industries/agent-client-protocol`). Like the Copilot SDK, ACP's reference transport is JSON-RPC 2.0 over **stdio** between an editor/client process and an agent subprocess — it is not a browser API. So `acp.html` also needs a small local bridge process, mirroring the Copilot plan for consistency and equal safety.

This document describes the target architecture, the exact files to add, and the manual steps the repo owner must take. No code in this plan is implemented yet; it is a design for a follow-up change.

## Why a bridge server is required

ACP agents are typically spawned as local subprocesses (e.g. `claude-code-acp`, `gemini --experimental-acp`, or any other ACP-compliant agent binary) and communicate over stdio using newline-delimited JSON-RPC 2.0 messages. A browser page cannot spawn a subprocess or read/write stdio, so the same pattern as the Copilot plan applies:

```
acp.html (browser)  <-- WebSocket -->  local bridge server (Node)  <-- stdio JSON-RPC -->  ACP agent subprocess
```

## Proposed new files

1. **`server/acp-bridge.mjs`** (new)
   - Uses `@agentclientprotocol/sdk`'s Client-side helper (`ClientSideConnection` or equivalent exported by the SDK) to speak ACP over stdio to a configured agent command.
   - Spawns the agent process specified by an env var, e.g. `ACP_AGENT_COMMAND` (default left unset — the bridge refuses to start without an explicit command, so nothing is invoked implicitly).
   - Implements the minimal required ACP client-side callbacks:
     - `sessionUpdate` — receives streamed agent output (assistant text chunks, tool-call notifications, plan updates) and relays them to the browser as JSON frames.
     - `requestPermission` — for this prototype, auto-denies or auto-approves only an explicit, narrow allow-list of read-only operations, and otherwise surfaces the permission prompt to the browser for the user to accept/reject (never silently grants broad permissions).
     - `readTextFile` / `writeTextFile` (if the agent requests them) — scoped strictly to a repo-owner-configured sandbox directory, never the whole filesystem, and disabled by default until the owner opts in via config.
   - Exposes one WebSocket endpoint, e.g. `ws://localhost:8788/acp`.
   - On each browser connection: performs the ACP `initialize` handshake, then `session/new` to create a session.
   - Relays browser frames `{ type: "prompt", text }` into an ACP `session/prompt` request; relays `sessionUpdate` notifications back as `{ type: "agent", text, meta }` frames.
   - Binds to `127.0.0.1` only.
   - On socket close or shutdown: sends `session/cancel` if a prompt is in flight, then terminates the agent subprocess.

2. **`server/package.json`** (shared with the Copilot bridge, or a sibling `server/acp/package.json` if the owner prefers fully separate dependency trees) — adds `@agentclientprotocol/sdk`.

3. **`acp.js`** (new, page-specific script, mirrors `copilot.js`)
   - Opens `new WebSocket("ws://localhost:8788/acp")`.
   - Reuses the existing history/form DOM wiring pattern from `app.js`.
   - Renders `sessionUpdate` events distinctly by kind (assistant message vs. tool call vs. plan update) so the harness visibly demonstrates ACP's richer update stream, not just plain text — this is the main visual difference from the Copilot variant.
   - Shows a "permission requested" inline prompt (approve/deny buttons) whenever the bridge forwards a `requestPermission` request, and sends the user's choice back over the socket — the bridge blocks on this before proceeding, so the browser is always in control of anything the agent wants to do beyond generating text.
   - Shows a clear "Bridge not running" / "Agent command not configured" banner if the WebSocket fails or the bridge reports no agent configured.

4. **`acp.html`** (edit)
   - Swap `<script src="app.js" defer>` for `<script src="acp.js" defer>`.
   - Add the same `data-bridge-status` element pattern as the Copilot page, plus a `data-permission-request` region for the approve/deny UI described above.

5. **`.env.example`** (extend the one from the Copilot plan, or add `server/acp/.env.example`)
   - Documents `ACP_AGENT_COMMAND` (e.g. `npx @zed-industries/claude-code-acp`) and any agent-specific env vars the chosen agent needs (e.g. an API key for the underlying model) — with a loud comment that any such key belongs in a local, gitignored `.env` file only, never committed.

6. **`.gitignore`** (edit, shared with the Copilot plan)
   - Add `server/.env`, `server/node_modules/`.

## Authentication (safety-critical)

ACP itself does not define authentication — that's between the bridge and whichever agent binary is configured. Concretely:

1. The repo owner chooses and installs an ACP-compliant agent (e.g. `@zed-industries/claude-code-acp`, which itself uses the Claude CLI's own login, or another agent using its own credential flow).
2. Any required API key for that agent is provided via a local, gitignored `server/.env` file (or the OS environment directly) — never committed, never sent to the browser, never logged by the bridge.
3. The bridge only ever passes configured env vars through to the spawned agent subprocess; it does not read or display them anywhere in its own output.
4. Because `requestPermission` is routed to the browser for confirmation, the bridge does not silently grant an agent broad filesystem or execution access — the repo owner (as the human at the browser) approves each sensitive action.

## Steps the repo owner must perform

1. Install Node.js 20+ if not already present.
2. Choose and install an ACP-compliant agent CLI (e.g. `npm install -g @zed-industries/claude-code-acp` or equivalent) and complete that agent's own auth/login flow, entirely outside this repo.
3. Copy `.env.example` to `server/.env`, set `ACP_AGENT_COMMAND` to the exact command to launch the chosen agent, and add any agent-specific secret the agent's own docs require.
4. `cd server && npm install` to pull down `@agentclientprotocol/sdk`.
5. `node server/acp-bridge.mjs` to start the local bridge on `127.0.0.1:8788` (a different port than the Copilot bridge so both can run side-by-side).
6. Open `acp.html`, confirm the bridge-status banner shows "connected," and try a prompt — approve or deny any permission prompt that appears.
7. `Ctrl+C` the bridge to stop; the agent subprocess is terminated.

## Safety notes

- The bridge binds only to `127.0.0.1`.
- No secrets live in this repository; they live in a gitignored `.env` and/or the agent's own external credential store.
- The bridge refuses to start without an explicit `ACP_AGENT_COMMAND`, so nothing is spawned by accident or by default.
- Filesystem/tool access requested by the agent is either disabled by default or requires the browser user's explicit approval via the `requestPermission` flow — the bridge never auto-approves broad access.
- The static page remains safe to open with no bridge running.
