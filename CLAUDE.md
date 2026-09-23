# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Remote MCP (Model Context Protocol) server for the Strateegia platform, deployed on Cloudflare Workers. Exposes 20 tools that map to the Strateegia Projects, Tools, and Users APIs, allowing MCP clients to manage projects, maps, points, comments, and tool templates.

## Commands

```bash
npm run dev          # Start local Wrangler dev server (http://localhost:8787/mcp)
npm run deploy       # Deploy to Cloudflare Workers
npm run type-check   # TypeScript type checking
npm run cf-typegen   # Regenerate worker-configuration.d.ts from wrangler.jsonc
```

## Architecture

**Runtime:** Cloudflare Workers, stateless, targeting MCP spec **2026-07-28** (no `initialize` handshake, no `Mcp-Session-Id`, no Durable Object). Built on `createMcpHandler` from `agents/mcp` with the MCP SDK v2 (`@modelcontextprotocol/server`). 2025-era clients (such as the `mcp-remote` bridge in the `.mcpb`) are still served through the handler's default `legacy: "stateless"` fallback. See `spec/007-mcp-2026-07-28.md`.

**Auth flow:** Client sends `Authorization: Bearer <api_key>` -> Worker validates presence and Origin -> Worker exchanges the key for a JWT (`exchangeApiKeyForJwt`, once per request) -> JWT is passed to the handler as request-scoped `authInfo` -> the server factory builds a fresh `McpServer` whose tools close over the JWT -> Tool handlers pass it to `strateegiaFetch()`. Token never stored, never logged.

**Auth failure responses (deliberate, see spec 007 stage 3):** no `Authorization` header returns 401 with `WWW-Authenticate: Bearer`; a header with an empty or rejected key returns **403**, not 401, because on any 401 `mcp-remote` starts an OAuth flow, fails at Dynamic Client Registration and hides the real message. OAuth discovery routes (`/.well-known/*`, `/register`, `/authorize`, `/token`) return a 404 JSON error saying the server uses an API key. Keep this behaviour when touching auth.

**Key files:**
- `src/index.ts`: Worker entrypoint. Auth check, Origin validation, key exchange, and `buildServer(jwt)`, which registers all tools via domain modules. The MCP handler is created once at module level; `allowedOriginHostnames: "*"` because Origin is already validated in the entrypoint.
- `src/strateegia-client.ts` — `strateegiaFetch(token, path, init?)` helper that builds URLs, injects Bearer token, and wraps errors as `StrateegiaApiError`.
- `src/tools/` — Tools organized by domain: `projects.ts` (3), `maps.ts` (3), `points.ts` (8), `comments.ts` (5), `tool-templates.ts` (1). Each file exports a `register*Tools(server, getToken)` function that uses `server.registerTool(name, { description, inputSchema: z.object({...}) }, handler)`. The SDK v2 `McpServer` has no `server.tool()`.

**Strateegia domain hierarchy:** Lab > Project > Map > Point > Content. Point types: Divergence (brainstorming), Convergence (polls/voting), Essay (long-form + evaluation), Monitor (progress tracking).

**Reading points without blowing the response limit:** `/v1/map/{id}/content` embeds every point *with* its participant content, so a busy map easily reaches megabytes and can exceed client limits. `get_map` therefore defaults to `detail: "summary"` (an index of id/type/title/position plus counts) and offers `"points"` (full config, content stripped) and `"full"` (raw). To read a single point, use `get_point` — the per-type routes (`/v1/{divergence,convergence,essay,monitor}-point/{id}`) answer 403 for a mismatched id, which is what makes type auto-detection possible. Monitor points are the exception to "one point, one call": their endpoint reports only `current_status`, so `get_point` also fetches `/v1/monitor-point/{id}/comments` for the full status history.

## Conventions

- Tool descriptions are dense — the LLM reads them as context. Explain what, when, and what it returns.
- Zod schemas use only fields the user would reasonably set. API-internal fields (e.g. `approved`) get hardcoded defaults.
- Every tool declares `annotations` from `src/tools/annotations.ts` (`READ_ONLY`, `ADDITIVE`, `REVERSIBLE_SET`, `OVERWRITE`). Always set all four hints: the MCP defaults (`destructiveHint: true`, `openWorldHint: true`) would flag even read tools as destructive.
- Tool failures return `isError: true`: use `apiErrorToMcpResult(err)` for API errors and `toolError(text)` for failures detected inside the tool. Never return a failure as plain content.
- Tool responses use compact `JSON.stringify(data)` (no indentation); indentation only costs tokens.
- All API errors propagate status codes: 401 (bad token), 403 (no permission), 422 (invalid body), 429 (rate limit).
- Strateegia API base: `https://api.strateegia.digital/projects`. Swagger: `https://api.strateegia.digital/projects/swagger-ui/index.html`.
- Never log or store the Authorization header value.
