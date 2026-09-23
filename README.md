# strateegia-mcp

Remote MCP server that exposes the [Strateegia](https://strateegia.digital) Projects API to MCP clients (Claude, Claude Desktop, Claude Code, Cursor, and others).

Runs on Cloudflare Workers and implements MCP spec **2026-07-28**: stateless, no sessions, no handshake. Clients on the 2025 protocol (including the `mcp-remote` bridge) are still served. The user's Strateegia API key is passed on every request and never stored.

## Tools

| Tool | Description |
|---|---|
| `list_projects` | List the user's projects (journeys), grouped by lab |
| `get_project` | Project details with members and maps |
| `create_project` | Create a project in a lab |
| `list_maps_in_project` | List the journey maps in a project |
| `create_map` | Create a map inside a project |
| `get_map` | Points of a map; a compact index by default (`detail`: `summary`, `points`, `full`) |
| `get_point` | One point in full, any type; detects the type when not given |
| `create_divergence_point` | Debate point: collect ideas and responses |
| `update_divergence_point` | Change a debate point's title, introduction or visibility |
| `add_question_to_divergence_point` | Add a question to a debate point |
| `create_convergence_point` | Decision point: group poll |
| `create_essay_point` | Evaluation point: long-form answers with optional peer review |
| `create_monitor_point` | Monitoring point: qualitative status or numeric KPI (`CUMULATIVE` or `RECURRING`) |
| `add_monitor_status` | Record a measurement on a monitoring point |
| `update_point_position` | Move any point on the map grid |
| `add_comment_to_question` | Answer a debate question |
| `reply_to_comment` | Reply to an answer |
| `like_comment` | Like an answer |
| `unlike_comment` | Remove your like from an answer |
| `list_tool_templates` | List the debate templates available to the user |

Every tool declares risk annotations (read-only, additive, reversible or overwrite), and failures come back with `isError: true`. No tool deletes anything.

## Development

```bash
npm install
npm run dev
```

This starts the Wrangler dev server at `http://localhost:8787`. The MCP endpoint is `/mcp`.

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Enter `http://localhost:8787/mcp` as the server URL and add the header `Authorization: Bearer <your_strateegia_api_key>`.

## Deploy

```bash
npm run deploy
```

Wrangler authenticates with `CLOUDFLARE_API_TOKEN` when it is set (it also reads it from `.env`); otherwise it falls back to `npx wrangler login`. The server is served at `https://strateegia-mcp.<your-account>.workers.dev/mcp`.

## Build the `.mcpb` bundle

```bash
npm run bundler
```

Output: `strateegia.mcpb` at the project root, ready to attach to a GitHub Release. The bundle is a thin `mcp-remote` bridge pointing at the deployed Worker, so it only needs rebuilding when `mcpb/manifest.json` or the `mcp-remote` version changes, not when tools change. To point it at another Worker, edit `server.mcp_config.args` in `mcpb/manifest.json`.

## Client configuration

Get an API key at https://app.strateegia.digital (Configurações > API Keys). Treat it like a password.

### Claude (web, desktop and mobile): custom connector

This connects straight over HTTP, with no local process, and works everywhere you use Claude. It needs the **Request headers** option in the connector dialog, which is in beta and not yet enabled for every organization. If you don't see it, use one of the Claude Desktop options below.

Customize > Connectors > Add custom connector:

- **MCP server URL**: `https://strateegia-mcp.<your-account>.workers.dev/mcp`
- **Authentication**: No sign-in
- **Request headers**: name `authorization`, value `Bearer <your_strateegia_api_key>` (include the word `Bearer` and the space; Claude sends the value exactly as typed)

### Claude Desktop: `.mcpb` extension

No JSON editing, suited to non-technical users.

1. Download the latest `strateegia.mcpb` (see [Releases](https://github.com/filipecalegario/strateegia-mcp/releases), or build it with `npm run bundler`)
2. Double-click it; Claude Desktop opens the install screen
3. Paste your Strateegia API key
4. Click Install

### Claude Desktop: manual (`claude_desktop_config.json`)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). `claude_desktop_config.json` launches local processes, so `mcp-remote` acts as the bridge to the remote server:

```json
{
  "mcpServers": {
    "strateegia": {
      "command": "npx",
      "args": [
        "mcp-remote@0.14.3",
        "https://strateegia-mcp.<your-account>.workers.dev/mcp",
        "--header",
        "Authorization: Bearer <your_strateegia_api_key>"
      ]
    }
  }
}
```

### Claude Code / Cursor (`mcp.json`)

These clients connect to remote servers directly with `url` and `headers` (Claude Code needs `"type": "http"`; Cursor infers it from `url`):

```json
{
  "mcpServers": {
    "strateegia": {
      "type": "http",
      "url": "https://strateegia-mcp.<your-account>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your_strateegia_api_key>"
      }
    }
  }
}
```

### Other stdio-only clients

Use the same [mcp-remote](https://www.npmjs.com/package/mcp-remote) bridge shown in the Claude Desktop manual setup.

## Auth model

The user's Strateegia API key (PAT) is sent as a Bearer token. On every request the Worker:

1. Reads `Authorization: Bearer <api_key>`
2. Exchanges the key for a short-lived JWT via `POST /users/v1/auth/api`
3. Passes the JWT to the tools, which call the Strateegia Projects API with it
4. Propagates API errors to the model as tool errors (`isError: true`)

This server does not use OAuth. Failed authentication is answered so that clients stop instead of going looking for OAuth:

| Situation | Response |
|---|---|
| No `Authorization` header | `401` with `WWW-Authenticate: Bearer` |
| Header present, key empty or rejected by Strateegia | `403` with a message saying how to fix the key |
| OAuth discovery routes (`/.well-known/*`, `/register`, `/authorize`, `/token`) | `404` with a JSON error explaining that the server uses an API key |

The `403` is deliberate: on any `401`, `mcp-remote` starts an OAuth flow, fails at client registration and hides the real cause. No credentials are stored, and a key revoked in Strateegia stops working here immediately.
