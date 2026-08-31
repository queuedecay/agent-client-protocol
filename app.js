(() => {
  const form = document.querySelector('[data-chat-form]');
  const promptInput = document.querySelector('[data-prompt]');
  const history = document.querySelector('[data-history]');
  const modelPicker = document.querySelector('[data-model]');
  const sessionTypePicker = document.querySelector('[data-session-type]');
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
    appendMessage('Echo', prompt, 'Local echo only · no network request sent');

    promptInput.value = '';
    promptInput.focus();
  });
})();
