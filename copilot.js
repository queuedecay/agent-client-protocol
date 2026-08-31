// copilot.js
//
// Browser-side script for copilot.html. Talks only to a local bridge server
// (server/copilot-bridge.mjs) over WebSocket at ws://localhost:8787/copilot.
// No credentials, tokens, or remote endpoints are ever embedded here — if the
// bridge is not running, the page falls back to a clear "not connected"
// banner instead of silently failing.
(() => {
  const BRIDGE_URL = 'ws://localhost:8787/copilot';

  const form = document.querySelector('[data-chat-form]');
  const promptInput = document.querySelector('[data-prompt]');
  const history = document.querySelector('[data-history]');
  const modelPicker = document.querySelector('[data-model]');
  const sessionTypePicker = document.querySelector('[data-session-type]');
  const bridgeStatus = document.querySelector('[data-bridge-status]');
  const harness = document.querySelector('[data-chat-harness]')?.dataset.chatHarness ?? 'Chat Harness';

  if (!form || !promptInput || !history || !modelPicker || !sessionTypePicker) {
    return;
  }

  const appendMessage = (role, text, meta) => {
    const message = document.createElement('article');
    message.className = `message ${role.toLowerCase()}`;

    const heading = document.createElement('h3');
    heading.textContent = role;

    const metadata = document.createElement('p');
    metadata.className = 'message-meta';
    metadata.textContent = meta;

    const body = document.createElement('p');
    body.className = 'message-body';
    body.textContent = text;

    message.append(heading, metadata, body);
    history.append(message);
    history.scrollTop = history.scrollHeight;
  };

  const setBridgeStatus = (status, text) => {
    if (!bridgeStatus) return;
    bridgeStatus.dataset.status = status;
    bridgeStatus.textContent = text;
  };

  let socket;
  let connected = false;

  const connect = () => {
    setBridgeStatus('connecting', 'Connecting to local Copilot SDK bridge…');

    try {
      socket = new WebSocket(BRIDGE_URL);
    } catch {
      setBridgeStatus(
        'error',
        'Could not open a WebSocket to the Copilot SDK bridge. See COPILOT-SDK-INTEGRATION.md to start it.',
      );
      return;
    }

    socket.addEventListener('open', () => {
      // Wait for the bridge's own "connected" status frame before flipping
      // the banner, since a real Copilot session still has to start.
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'status' && msg.status === 'connected') {
        connected = true;
        setBridgeStatus('connected', 'Connected to the Copilot SDK bridge.');
      } else if (msg.type === 'assistant') {
        history.querySelector('[data-empty-state]')?.remove();
        appendMessage('Assistant', msg.text ?? '', msg.meta ?? 'GitHub Copilot SDK');
      } else if (msg.type === 'error') {
        setBridgeStatus('error', msg.message ?? 'The Copilot SDK bridge reported an error.');
      }
    });

    socket.addEventListener('close', () => {
      connected = false;
      setBridgeStatus(
        'disconnected',
        'Not connected. Start the local bridge with `node server/copilot-bridge.mjs` (see COPILOT-SDK-INTEGRATION.md).',
      );
    });

    socket.addEventListener('error', () => {
      connected = false;
      setBridgeStatus(
        'error',
        'Could not reach the Copilot SDK bridge at ' + BRIDGE_URL + '. See COPILOT-SDK-INTEGRATION.md to start it.',
      );
    });
  };

  connect();

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const prompt = promptInput.value.trim();
    if (!prompt) {
      promptInput.focus();
      return;
    }

    history.querySelector('[data-empty-state]')?.remove();

    const model = modelPicker.value;
    const sessionType = sessionTypePicker.value;
    const meta = `${harness} · ${model} · ${sessionType}`;

    appendMessage('User', prompt, meta);

    if (connected && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'prompt', text: prompt, model, sessionType }));
    } else {
      appendMessage(
        'System',
        'No bridge connection — this prompt was not sent anywhere. Start server/copilot-bridge.mjs to get a real reply.',
        'Local only · no network request sent',
      );
    }

    promptInput.value = '';
    promptInput.focus();
  });
})();
