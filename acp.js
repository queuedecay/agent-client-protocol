// acp.js
//
// Browser-side script for acp.html. Talks only to a local bridge server
// (server/acp-bridge.mjs) over WebSocket at ws://localhost:8788/acp. No
// credentials, tokens, or remote endpoints are ever embedded here — if the
// bridge is not running, the page falls back to a clear "not connected"
// banner instead of silently failing. Any permission request from the agent
// is surfaced here for the user to approve or deny; nothing is auto-granted.
(() => {
  const BRIDGE_URL = 'ws://localhost:8788/acp';

  const form = document.querySelector('[data-chat-form]');
  const promptInput = document.querySelector('[data-prompt]');
  const history = document.querySelector('[data-history]');
  const modelPicker = document.querySelector('[data-model]');
  const sessionTypePicker = document.querySelector('[data-session-type]');
  const bridgeStatus = document.querySelector('[data-bridge-status]');
  const permissionRegion = document.querySelector('[data-permission-request]');
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

  const clearPermissionPrompt = () => {
    if (permissionRegion) permissionRegion.replaceChildren();
  };

  const showPermissionPrompt = (id, description, respond) => {
    if (!permissionRegion) return;
    clearPermissionPrompt();

    const wrapper = document.createElement('div');
    wrapper.className = 'permission-prompt';

    const text = document.createElement('p');
    text.textContent = description;

    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => {
      respond(id, true);
      clearPermissionPrompt();
    });

    const denyBtn = document.createElement('button');
    denyBtn.type = 'button';
    denyBtn.className = 'secondary-button';
    denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', () => {
      respond(id, false);
      clearPermissionPrompt();
    });

    const actions = document.createElement('div');
    actions.className = 'form-actions';
    actions.append(denyBtn, approveBtn);

    wrapper.append(text, actions);
    permissionRegion.append(wrapper);
  };

  let socket;
  let connected = false;

  const respondToPermission = (id, approved) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'permission-response', id, approved }));
    }
  };

  const connect = () => {
    setBridgeStatus('connecting', 'Connecting to local ACP bridge…');

    try {
      socket = new WebSocket(BRIDGE_URL);
    } catch {
      setBridgeStatus(
        'error',
        'Could not open a WebSocket to the ACP bridge. See ACP-INTEGRATION.md to start it.',
      );
      return;
    }

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'status' && msg.status === 'connected') {
        connected = true;
        setBridgeStatus('connected', 'Connected to the ACP bridge.');
      } else if (msg.type === 'agent') {
        history.querySelector('[data-empty-state]')?.remove();
        const role = msg.kind && msg.kind !== 'message' ? msg.kind : 'Agent';
        appendMessage(role, msg.text ?? '', msg.meta ?? 'Agent Client Protocol');
      } else if (msg.type === 'permission-request') {
        showPermissionPrompt(msg.id, msg.description ?? 'The agent is requesting permission.', respondToPermission);
      } else if (msg.type === 'error') {
        setBridgeStatus('error', msg.message ?? 'The ACP bridge reported an error.');
      }
    });

    socket.addEventListener('close', () => {
      connected = false;
      clearPermissionPrompt();
      setBridgeStatus(
        'disconnected',
        'Not connected. Configure ACP_AGENT_COMMAND and start the local bridge with `node server/acp-bridge.mjs` (see ACP-INTEGRATION.md).',
      );
    });

    socket.addEventListener('error', () => {
      connected = false;
      setBridgeStatus(
        'error',
        'Could not reach the ACP bridge at ' + BRIDGE_URL + '. See ACP-INTEGRATION.md to start it.',
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
        'No bridge connection — this prompt was not sent anywhere. Start server/acp-bridge.mjs (with ACP_AGENT_COMMAND set) to get a real reply.',
        'Local only · no network request sent',
      );
    }

    promptInput.value = '';
    promptInput.focus();
  });
})();
