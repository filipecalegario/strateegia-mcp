# strateegia-mcp

Remote MCP server that exposes the [Strateegia](https://strateegia.digital) Projects API to MCP clients (Claude.ai, Claude Desktop, Cursor, ChatGPT, etc.).

Runs on Cloudflare Workers. Stateless — the user's Strateegia API key is passed through on every request, never stored.

## v1 Tools

| Tool | Description |
|---|---|
| `list_projects` | List user's projects (paginated) |
| `get_project` | Full project details with members and maps |
| `create_project` | Create a project in a lab |
| `list_maps_in_project` | List journey maps in a project |
| `get_map` | Full map with all points and structure |
| `create_divergence_point` | Collect ideas/responses (brainstorming) |
| `create_convergence_point` | Group decision-making via polls |
| `create_essay_point` | Long-form text with optional peer evaluation |
| `create_monitor_point` | Track qualitative or quantitative progress |
| `add_comment_to_question` | Add a response to a divergence question |

## Development

```bash
npm install
npm run dev
```

This starts Wrangler dev server at `http://localhost:8787`. The MCP endpoint is `/mcp`.

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Enter `http://localhost:8787/mcp` as the server URL. Add an `Authorization: Bearer <your_strateegia_api_key>` header.

## Deploy

```bash
npx wrangler deploy
```

Your MCP server will be available at `https://strateegia-mcp.<your-account>.workers.dev/mcp`.

## Client Configuration

### Claude.ai (Web)

Settings > Connectors > Add custom connector:
- **URL**: `https://strateegia-mcp.<your-account>.workers.dev/mcp`
- Add header: `Authorization: Bearer <your_strateegia_api_key>`

### Cursor / Claude Code (mcp.json)

These clients support remote MCP servers with `url` + `headers` directly:

```json
{
  "mcpServers": {
    "strateegia": {
      "url": "https://strateegia-mcp.<your-account>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your_strateegia_api_key>"
      }
    }
  }
}
```

### Claude Desktop (claude_desktop_config.json)

Claude Desktop uses `mcp-remote` as a proxy. Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "strateegia": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://strateegia-mcp.<your-account>.workers.dev/mcp",
        "--header",
        "Authorization: Bearer <your_strateegia_api_key>"
      ]
    }
  }
}
```

### Other stdio-only clients

Any client that only supports stdio transport can use the same [mcp-remote](https://www.npmjs.com/package/mcp-remote) approach shown above.

## Auth Model

The user provides their Strateegia API key (PAT) as a Bearer token. The worker:

1. Extracts `Authorization: Bearer <api_key>` from each request
2. Rejects with 401 if missing
3. Exchanges the API key for a JWT via `POST /users/v1/auth/api`
4. Uses the JWT to call the Strateegia Projects API
5. Propagates any 401/403/422/429 errors from the API

No credentials are stored. The JWT is ephemeral — it only exists during the request lifecycle. If the API key is revoked in Strateegia, it stops working here automatically.
