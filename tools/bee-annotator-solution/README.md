# Bee Conversation Annotator (Reference Solution)

Reverse proxy that listens for **completed** Bee conversations, fetches their full summary and transcript, filters for design-related content, and surfaces them as rich cards in the proxied app's sidebar. Clicking "Apply" invokes an AI coding agent to make the changes.

## How it works

1. Proxies your dev server (e.g. Vite on `:5173`) on a separate port (`:9997`)
2. Spawns `bee stream --types update-conversation --json` to detect completed conversations
3. When a conversation reaches `state: "processed"`, fetches full details via `bee conversations get <id> --json`
4. Fetches the transcript via `bee conversations transcript <id> --json`
5. Filters for design-related keywords in the title/summary
6. Injects a sidebar showing full conversation cards with summary + transcript excerpt
7. Each card has **Apply** (AI CLI), **Details** (full view), **Copy**, and **Dismiss** buttons

## Usage

```bash
# Make sure your dev server is running first
cd thinking-cap-podcast-app && npm run dev

# In another terminal, from the repo root:
node tools/bee-annotator-solution/proxy-worker.js \
  --target http://localhost:5173 \
  --port 9997 \
  --feedback thinking-cap-podcast-app/.tmp/bee-conv-feedback.json \
  --inspector-script tools/bee-annotator-solution/inspector.js \
  --app-dir thinking-cap-podcast-app
```

Then open `http://localhost:9997/` — you'll see the app with the Bee Conversations sidebar.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--target` | Upstream app URL to proxy | (required) |
| `--port` | Port for the proxy | (required) |
| `--feedback` | Path to feedback JSON file | (required) |
| `--inspector-script` | Path to `inspector.js` | (required) |
| `--app-dir` | App root for AI CLI | cwd |
| `--cli` | AI CLI command | auto-detects `claude` or `kiro-cli` |
| `--filter` | Comma-separated filter keywords | design,css,color,font,layout,... |

## Prerequisites

- [Bee CLI](https://github.com/bee-computer/bee-cli) installed and authenticated (`bee login`, then verify with `bee status`)
- `claude` (Claude Code) or `kiro-cli` on your PATH
- A running dev server to proxy
