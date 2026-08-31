# Copilot SDK vs. Agent Client Protocol: comparing the two harnesses

This page is the plan for a third, final static page — `comparison.html` — that will sit alongside `copilot.html` and `acp.html` once both integrations described in [COPILOT-SDK-INTEGRATION.md](/c:/Users/fmigacz/Code/agent-client-protocol/agent-client-protocol/COPILOT-SDK-INTEGRATION.md) and [ACP-INTEGRATION.md](/c:/Users/fmigacz/Code/agent-client-protocol/agent-client-protocol/ACP-INTEGRATION.md) are implemented. It explains what each variant demonstrates and why they differ, similar in spirit to how VS Code's own Agent Harness lets you switch between different agent backends behind one consistent UI.

## Proposed new file

- **`comparison.html`** — a static page, linked from `index.html` as a third card, styled with a neutral (e.g. purple/gray) theme distinct from the pink Copilot card and blue ACP card. No script/bridge needed — it is pure documentation content rendered as HTML, plus optionally embedding the same chat-shell markup twice, side by side, in a disabled/read-only "preview" state so a visitor can see both message-rendering styles without starting either bridge.

## Content outline for `comparison.html`

### 1. What each protocol is

| | GitHub Copilot SDK | Agent Client Protocol (ACP) |
|---|---|---|
| Origin | GitHub's official SDK for embedding Copilot CLI/agent sessions in your own app | Open, editor-agnostic protocol originated at Zed Industries, now `@agentclientprotocol/sdk` |
| Transport | Local stdio JSON-RPC-like protocol between the SDK and the `copilot` CLI process | Local stdio JSON-RPC 2.0 between an editor/client and any ACP-compliant agent process |
| Scope | Tied to GitHub Copilot specifically | Protocol-first: any agent (Claude, Gemini, custom agents) can implement the ACP server side; any editor can implement the client side |
| Session model | `client.createSession()` → `session.send({ prompt })` → `assistant.message` events | `initialize` → `session/new` → `session/prompt` → `sessionUpdate` notifications |
| Extensibility | Tool registration is Copilot-specific | First-class support for tool calls, plan/step updates, and a `requestPermission` handshake baked into the protocol itself |
| Vendor lock-in | Coupled to GitHub Copilot | Designed so the same client code can talk to multiple different agents by swapping the spawned command |

### 2. Why both need a local bridge

Both SDKs are Node-only, stdio-oriented libraries — neither is meant to run directly in a browser. Both harness pages therefore talk to a small local Node "bridge" over WebSocket rather than importing an SDK into browser JS. This keeps the security model identical between the two variants: everything sensitive (CLI auth, API keys, subprocess spawning) stays server-side on `127.0.0.1`, and the browser only ever sees relayed, already-sanitized JSON messages.

### 3. What's different in the UI

- The Copilot variant renders a flat stream of `User` / `Assistant` message bubbles (see `appendMessage` in [copilot.js](/c:/Users/fmigacz/Code/agent-client-protocol/agent-client-protocol/copilot.js)) — modeled on a simple back-and-forth chat.
- The ACP variant additionally distinguishes assistant text, tool-call notifications, and plan/step updates as separate message kinds, and adds an inline permission-approval control — modeled on ACP's richer `sessionUpdate` stream and its explicit `requestPermission` handshake.
- This mirrors how VS Code's built-in Agent Harness/Chat view presents plain assistant replies alongside tool invocations and permission prompts in one unified timeline — the goal for both `copilot.html` and `acp.html` once wired up is to reach that same fidelity, each through its own protocol's native concepts.

### 4. When to prefer which

- Prefer the **Copilot SDK** path when you specifically want GitHub Copilot's models/agent and don't need to swap in other agents.
- Prefer **ACP** when you want an editor/UI that can point at multiple different agent backends without rewriting the client, or when you're building tooling (like an editor extension) that should work with any ACP-compliant agent, not just one vendor's.

## Steps to implement this page

1. Complete (or at least stub) both bridges described in the other two plan documents so real example screenshots/messages can be captured for this page.
2. Write `comparison.html` using the existing `styles.css` conventions (add a third `.variant-card.neutral` style and a `theme-neutral` body class, reusing the same CSS custom-property pattern already used for pink/blue).
3. Add a third card to the `nav.variant-links` in `index.html` linking to `comparison.html`.
4. No bridge, network access, or secrets are needed for this page — it is pure static documentation and can be built and reviewed independently of the other two integrations.
