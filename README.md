# agent-client-protocol

An exploration of integrating a chat harness with the Agent Client Protocol.

## Static chat harness prototypes

This repository currently includes two intentionally safe, static chat harness pages:

- `copilot.html` — a pink GitHub Copilot Chat SDK prototype.
- `acp.html` — a blue Agent Client Protocol prototype.

Open `index.html` in a browser and choose either variant. Each page includes a model picker, a session type selector (Agent, Plan, Ask), a user prompt box, and a chat session history window. Submitting a prompt only echoes the text locally into the history window.

No secrets, credentials, SDK configuration, ACP endpoint configuration, or network requests are included. The pages are placeholders for a future integration with GitHub Copilot and ACP.
