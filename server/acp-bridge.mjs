// server/acp-bridge.mjs
//
// Local-only bridge between acp.html and an Agent Client Protocol (ACP)
// compliant agent, via the @agentclientprotocol/sdk client-side app API.
//
// Why this exists: ACP agents are spawned as local subprocesses and speak
// newline-delimited JSON-RPC 2.0 over stdio. Browsers cannot spawn processes,
// so this small Node server relays messages between a browser WebSocket
// connection and a real ACP session. It binds to 127.0.0.1 only, refuses to
// start without an explicitly configured agent command, and routes every
// permission request from the agent to the browser for the user to approve
// or deny — it never auto-grants broad access.
//
// This uses the SDK's modern `client()` / `connectWith()` fluent API (the
// class-based `ClientSideConnection` is deprecated upstream in favor of this
// app-style API), together with `ndJsonStream()` to adapt the agent
// subprocess's Node stdio streams into the Web Streams the SDK expects.
//
// Run with: node server/acp-bridge.mjs
// Requires: `cd server && npm install` first, and ACP_AGENT_COMMAND set in
// server/.env (see .env.example and ACP-INTEGRATION.md).

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { client, ndJsonStream } from '@agentclientprotocol/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '.env') });

const PORT = Number(process.env.ACP_BRIDGE_PORT ?? 8788);
const HOST = '127.0.0.1'; // never bind to 0.0.0.0 — this bridge is local-only
const AGENT_COMMAND = process.env.ACP_AGENT_COMMAND?.trim();
// The agent's working directory / filesystem scope for the ACP session.
// Defaults to this repo so a misconfigured agent can't wander outside it.
const AGENT_CWD = process.env.ACP_AGENT_CWD?.trim() || join(__dirname, '..');

if (!AGENT_COMMAND) {
  console.error(
    'ACP_AGENT_COMMAND is not set. Refusing to start: this bridge never ' +
      'spawns an agent implicitly. Copy .env.example to server/.env and set ' +
      'ACP_AGENT_COMMAND to the command that launches your chosen ACP agent ' +
      '(see ACP-INTEGRATION.md).',
  );
  process.exit(1);
}

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ACP bridge is running. Connect over WebSocket at /acp.\n');
});

const wss = new WebSocketServer({ server: httpServer, path: '/acp' });

/** Extracts plain text from an ACP ContentBlock, if it is text. */
function textOf(contentBlock) {
  return contentBlock?.type === 'text' ? contentBlock.text ?? '' : '';
}

wss.on('connection', async (socket) => {
  const send = (payload) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  };

  // Track pending permission requests so the browser's approve/deny reply
  // can be matched back to the ACP request that is blocking on it.
  const pendingPermissions = new Map();
  let nextPermissionId = 1;

  let agentProcess;
  let activeSession; // set once the ACP session has started
  let closed = false;

  const app = client({ name: 'agent-client-protocol-demo' })
    .onNotification('session/update', ({ params }) => {
      const update = params.update;
      switch (update.sessionUpdate) {
        case 'agent_message_chunk':
          send({
            type: 'agent',
            kind: 'message',
            text: textOf(update.content),
            meta: 'ACP · session/update (agent_message_chunk)',
          });
          break;
        case 'agent_thought_chunk':
          send({
            type: 'agent',
            kind: 'thought',
            text: textOf(update.content),
            meta: 'ACP · session/update (agent_thought_chunk)',
          });
          break;
        case 'tool_call':
        case 'tool_call_update':
          send({
            type: 'agent',
            kind: 'tool',
            text: update.title ?? update.toolCallId ?? '',
            meta: `ACP · session/update (${update.sessionUpdate})`,
          });
          break;
        default:
          // Plans, mode updates, usage updates, etc. are not rendered in
          // this minimal prototype UI, but nothing prevents extending it.
          break;
      }
    })
    .onRequest('session/request_permission', ({ params }) => {
      const id = nextPermissionId++;
      const options = params.options ?? [];
      // Pick a representative "allow" and "reject" option from what the
      // agent offered, since the browser UI only presents a simple
      // approve/deny choice rather than the full option list.
      const allowOption = options.find((opt) => opt.kind?.startsWith('allow')) ?? options[0];
      const rejectOption = options.find((opt) => opt.kind?.startsWith('reject'));
      send({
        type: 'permission-request',
        id,
        description: params.toolCall?.title ?? 'The agent is requesting permission.',
        options: options.map((opt) => ({ id: opt.optionId, label: opt.name ?? opt.optionId })),
      });
      return new Promise((resolve) => {
        pendingPermissions.set(id, (approved) => {
          const chosen = approved ? allowOption : rejectOption;
          if (chosen) {
            resolve({ outcome: { outcome: 'selected', optionId: chosen.optionId } });
          } else {
            resolve({ outcome: { outcome: 'cancelled' } });
          }
        });
      });
    });
  // readTextFile / writeTextFile are intentionally left unregistered: this
  // prototype does not grant filesystem access. A repo owner who wants this
  // must explicitly register those handlers, scoped to a sandbox directory.

  try {
    // Spawn the configured agent as a subprocess, wired up over stdio.
    const [command, ...args] = AGENT_COMMAND.split(' ');
    agentProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: process.env, // pass through any agent-specific secrets from server/.env
    });

    agentProcess.on('error', (error) => {
      send({
        type: 'error',
        message: `Failed to launch ACP agent "${AGENT_COMMAND}": ${error.message}`,
      });
    });

    // ndJsonStream needs Web Streams; the agent subprocess exposes Node
    // streams, so adapt them with node:stream's toWeb() helpers.
    const stream = ndJsonStream(
      Writable.toWeb(agentProcess.stdin),
      Readable.toWeb(agentProcess.stdout),
    );

    // connectWith() owns the connection for the lifetime of the callback;
    // we resolve that promise only once the browser socket closes, so the
    // ACP session and the WebSocket connection share a lifetime.
    const connectionClosed = new Promise((resolve) => {
      socket.once('close', resolve);
    });

    app
      .connectWith(stream, async (ctx) => {
        const session = await ctx.buildSession(AGENT_CWD).start();
        activeSession = session;
        send({ type: 'status', status: 'connected' });
        await connectionClosed;
      })
      .catch((error) => {
        if (!closed) {
          send({
            type: 'error',
            message: `ACP connection ended unexpectedly: ${error?.message ?? String(error)}`,
          });
        }
      });
  } catch (error) {
    send({
      type: 'error',
      message: `Failed to start an ACP session: ${error?.message ?? String(error)}`,
    });
    socket.close();
    return;
  }

  socket.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames
    }

    if (msg.type === 'prompt' && typeof msg.text === 'string' && msg.text.trim()) {
      if (!activeSession) {
        send({ type: 'error', message: 'Session is not ready yet, please wait.' });
        return;
      }
      try {
        await activeSession.prompt(msg.text);
      } catch (error) {
        send({
          type: 'error',
          message: `Failed to send prompt: ${error?.message ?? String(error)}`,
        });
      }
      return;
    }

    if (msg.type === 'permission-response' && typeof msg.id === 'number') {
      const resolve = pendingPermissions.get(msg.id);
      if (resolve) {
        pendingPermissions.delete(msg.id);
        resolve(Boolean(msg.approved));
      }
      return;
    }
  });

  socket.on('close', () => {
    closed = true;
    activeSession?.dispose?.();
    agentProcess?.kill();
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`ACP bridge listening on ws://${HOST}:${PORT}/acp`);
  console.log(`Configured agent command: ${AGENT_COMMAND}`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
