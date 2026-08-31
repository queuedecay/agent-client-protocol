// server/copilot-bridge.mjs
//
// Local-only bridge between copilot.html and the GitHub Copilot SDK.
//
// Why this exists: @github/copilot-sdk spawns and talks to the `copilot` CLI
// over stdio. Browsers cannot spawn processes, so this small Node server
// relays messages between a browser WebSocket connection and a real
// CopilotClient session. It binds to 127.0.0.1 only and is never meant to be
// deployed or exposed beyond your own machine.
//
// Run with: node server/copilot-bridge.mjs
// Requires: `cd server && npm install` first, and a `copilot` CLI that has
// already been authenticated on this machine (see COPILOT-SDK-INTEGRATION.md).

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { CopilotClient } from '@github/copilot-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '.env') });

const PORT = Number(process.env.COPILOT_BRIDGE_PORT ?? 8787);
const LOG_LEVEL = process.env.COPILOT_SDK_LOG_LEVEL ?? 'error';
const HOST = '127.0.0.1'; // never bind to 0.0.0.0 — this bridge is local-only

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Copilot SDK bridge is running. Connect over WebSocket at /copilot.\n');
});

const wss = new WebSocketServer({ server: httpServer, path: '/copilot' });

let client;

async function getClient() {
  if (!client) {
    client = new CopilotClient({ logLevel: LOG_LEVEL });
    await client.start();
  }
  return client;
}

wss.on('connection', async (socket) => {
  let session;

  const send = (payload) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  };

  try {
    const copilot = await getClient();
    session = await copilot.createSession({
      systemMessage: {
        mode: 'append',
        content:
          'You are a helpful assistant embedded in a local prototype chat harness.',
      },
    });

    session.on('assistant.message', (event) => {
      send({
        type: 'assistant',
        text: event?.data?.content ?? '',
        meta: 'GitHub Copilot SDK · assistant.message',
      });
    });

    send({ type: 'status', status: 'connected' });
  } catch (error) {
    send({
      type: 'error',
      message:
        'Failed to start a Copilot session. Is the `copilot` CLI installed and ' +
        'authenticated on this machine? (run `copilot auth login`, then restart ' +
        'this bridge). Original error: ' +
        (error?.message ?? String(error)),
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

    if (msg.type !== 'prompt' || typeof msg.text !== 'string' || !msg.text.trim()) {
      return;
    }

    try {
      await session.send({ prompt: msg.text });
    } catch (error) {
      send({
        type: 'error',
        message: `Failed to send prompt: ${error?.message ?? String(error)}`,
      });
    }
  });

  socket.on('close', async () => {
    try {
      await session?.disconnect();
    } catch {
      // best-effort cleanup; nothing else to do if this fails
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Copilot SDK bridge listening on ws://${HOST}:${PORT}/copilot`);
});

async function shutdown() {
  console.log('\nShutting down Copilot SDK bridge…');
  try {
    await client?.stop();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
