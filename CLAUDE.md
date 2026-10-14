# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Remote MCP (Model Context Protocol) server for the Strateegia platform, deployed on Cloudflare Workers. Exposes 24 tools that map to the Strateegia Projects, Tools, and Users APIs, allowing MCP clients to manage projects, maps, points, comments, and tool templates.

## Commands

```bash
npm run dev          # Start local Wrangler dev server (http://localhost:8787/mcp)
npm run deploy       # Deploy to Cloudflare Workers (production API)
npm run deploy:dev   # Deploy strateegia-mcp-dev, which talks to api.dev.strateegia.digital
npm run dev:env-dev  # Local dev server against the dev API
npm run type-check   # TypeScript type checking
npm run cf-typegen   # Regenerate worker-configuration.d.ts from wrangler.jsonc
```

## Architecture

**Runtime:** Cloudflare Workers, stateless, targeting MCP spec **2026-07-28** (no `initialize` handshake, no `Mcp-Session-Id`, no Durable Object). Built on `createMcpHandler` from `agents/mcp` with the MCP SDK v2 (`@modelcontextprotocol/server`). 2025-era clients (such as the `mcp-remote` bridge in the `.mcpb`) are still served through the handler's default `legacy: "stateless"` fallback. See `spec/007-mcp-2026-07-28.md`.

**Auth flow:** Client sends `Authorization: Bearer <api_key>` -> Worker validates presence and Origin -> Worker exchanges the key for a JWT (`exchangeApiKeyForJwt`, once per request) -> JWT is passed to the handler as request-scoped `authInfo` -> the server factory builds a fresh `McpServer` whose tools close over the JWT -> Tool handlers pass it to `strateegiaFetch()`. Token never stored, never logged. Platform services (sp-service-llm) may instead send the user's session JWT directly; `looksLikeJwt` detects it and skips the exchange, since API keys are 50 alphanumeric characters with no dots.

**Auth failure responses (deliberate, see spec 007 stage 3):** no `Authorization` header returns 401 with `WWW-Authenticate: Bearer`; a header with an empty or rejected key returns **403**, not 401, because on any 401 `mcp-remote` starts an OAuth flow, fails at Dynamic Client Registration and hides the real message. OAuth discovery routes (`/.well-known/*`, `/register`, `/authorize`, `/token`) return a 404 JSON error saying the server uses an API key. Keep this behaviour when touching auth.

**Key files:**
- `src/index.ts`: Worker entrypoint. Auth check, Origin validation, key exchange, and `buildServer(jwt)`, which registers all tools via domain modules. The MCP handler is created once at module level; `allowedOriginHostnames: "*"` because Origin is already validated in the entrypoint.
- `src/strateegia-client.ts` — `strateegiaFetch(token, path, init?)` helper that builds URLs, injects Bearer token, and wraps errors as `StrateegiaApiError`.
- `src/tools/` — Tools organized by domain: `projects.ts` (3), `maps.ts` (3), `points.ts` (9), `comments.ts` (5), `tool-templates.ts` (1), `point-content.ts` (1), `point-editing.ts` (2); `point-types.ts` holds the shared type detection (`resolvePoint`). Each file exports a `register*Tools(server, getToken)` function that uses `server.registerTool(name, { description, inputSchema: z.object({...}) }, handler)`. The SDK v2 `McpServer` has no `server.tool()`.

**Strateegia domain hierarchy:** Lab > Project > Map > Point > Content. Point types: Divergence (brainstorming), Convergence (polls/voting), Essay (long-form + evaluation), Monitor (progress tracking), Checkpoint (meeting), Notice (announcement), Status (survey, "ponto de pesquisa" in the UI: a branching questionnaire of single choice questions, `/v1/status-point/{id}`, listed by the map content as `status_points`).

**Reading points without blowing the response limit:** `/v1/map/{id}/content` embeds every point *with* its participant content, so a busy map easily reaches megabytes and can exceed client limits. `get_map` therefore defaults to `detail: "summary"` (an index of id/type/title/position plus counts) and offers `"points"` (full config, content stripped) and `"full"` (raw). To read a single point, use `get_point` — the per-type routes (`/v1/{divergence,convergence,essay,monitor}-point/{id}`) answer 403 for a mismatched id, which is what makes type auto-detection possible. Monitor points are the exception to "one point, one call": their endpoint reports only `current_status`, so `get_point` also fetches `/v1/monitor-point/{id}/comments` for the full status history.

**Editing points:** `update_point` (`src/tools/point-editing.ts`) edits every point type; `FIELD_SUPPORT` says which fields each type takes, and a field the type does not take is rejected before any call. Monitor uses one partial `PATCH`; meeting (`/v1/checkpoint/{id}`) and notice only have a whole-object `PUT`, so the current point is read and the unchanged values sent back (the notice always goes with `send_email: false`, so an edit never re-sends it). Essay modes are booleans mapped to `/{mode}/enable|disable`, applied before the closing date because the API only accepts an essay closing date while `end_time_mode` is on. Several fields mean several calls; a failure midway reports what was applied. `close_point` is separate (`IRREVERSIBLE`): the API has no reopen, and a meeting can only be closed once its date has arrived.

**API quirks:** date-times go in UTC without offset (`toApiDateTime` converts any ISO 8601 input; the API rejects `-03:00`). Several write endpoints answer 200 with an empty body, so `strateegiaFetch` returns `null` for any empty body, not only 204.

**Reading participation:** `get_point_content` (`src/tools/point-content.ts`) returns what participants produced, which `get_point` leaves out. It probes the same per-type routes plus `/v1/checkpoint/{id}`, then dispatches: debate comments are reachable only per question, so it lists `/v1/divergence-point/{id}/question` and pages `/question/{qid}/comment` for each (or one, with `question_id`); checkpoints page `/v1/checkpoint/{id}/comment`; surveys read `/v1/status-point/{id}/answer/responses` (everything at once), count votes per option over finalized responses only, as the platform chart does, and page the individual responses locally without respondent ids (the `/identified` endpoint, with names and emails, is left out on purpose; reading results needs journey staff or `share_results_mode`); essay `/responses` and monitor `/comments` return everything at once, so they are paged locally; convergence has no results endpoint, but each option carries `count_vote` and the point `answer_count`, so aggregated votes come from the point itself (individual votes are not exposed). Output is one envelope `{point_id, point_type, items, page, size, total, has_more}`, authors reduced to name (plus `is_assistant` when true). Default page size is 10 and essay evaluation feedback is opt-in (`include_evaluation_feedback`), because both dominate response size and the in-platform chat has a token budget per chat room.

## Conventions

- Tool descriptions are dense — the LLM reads them as context. Explain what, when, and what it returns.
- Zod schemas use only fields the user would reasonably set. API-internal fields (e.g. `approved`) get hardcoded defaults.
- Every tool declares `annotations` from `src/tools/annotations.ts` (`READ_ONLY`, `ADDITIVE`, `REVERSIBLE_SET`, `OVERWRITE`, `IRREVERSIBLE`). Always set all four hints: the MCP defaults (`destructiveHint: true`, `openWorldHint: true`) would flag even read tools as destructive.
- Tool failures return `isError: true`: use `apiErrorToMcpResult(err)` for API errors and `toolError(text)` for failures detected inside the tool. Never return a failure as plain content.
- Tool responses use compact `JSON.stringify(data)` (no indentation); indentation only costs tokens.
- All API errors propagate status codes: 401 (bad token), 403 (no permission), 422 (invalid body), 429 (rate limit).
- Strateegia API base comes from the `STRATEEGIA_API_URL` var (`wrangler.jsonc`): `https://api.strateegia.digital` in production, `https://api.dev.strateegia.digital` in the `dev` env. Build URLs with `serviceUrl(service)`, never hardcode the host. Swagger: `<base>/projects/swagger-ui/index.html`.
- Never log or store the Authorization header value.
