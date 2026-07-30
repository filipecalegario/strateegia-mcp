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

**Runtime:** Cloudflare Workers with Durable Objects (required by `agents` SDK, but no state is persisted — the architecture is functionally stateless).

**Auth flow:** Client sends `Authorization: Bearer <token>` -> Worker validates presence -> McpAgent captures token per-request -> Tool handlers pass it to `strateegiaFetch()` -> Strateegia API validates it. Token never stored, never logged.

**Key files:**
- `src/index.ts` — Worker entrypoint: auth middleware, Origin validation, `StrateegiaAgent` (McpAgent subclass). The `fetch()` override captures the auth token before MCP processing. `init()` registers all tools via domain modules.
- `src/strateegia-client.ts` — `strateegiaFetch(token, path, init?)` helper that builds URLs, injects Bearer token, and wraps errors as `StrateegiaApiError`.
- `src/tools/` — Tools organized by domain: `projects.ts` (3), `maps.ts` (3), `points.ts` (8), `comments.ts` (5), `tool-templates.ts` (1). Each file exports a `register*Tools(server, getToken)` function.

**Strateegia domain hierarchy:** Lab > Project > Map > Point > Content. Point types: Divergence (brainstorming), Convergence (polls/voting), Essay (long-form + evaluation), Monitor (progress tracking).

**Reading points without blowing the response limit:** `/v1/map/{id}/content` embeds every point *with* its participant content, so a busy map easily reaches megabytes and can exceed client limits. `get_map` therefore defaults to `detail: "summary"` (an index of id/type/title/position plus counts) and offers `"points"` (full config, content stripped) and `"full"` (raw). To read a single point, use `get_point` — the per-type routes (`/v1/{divergence,convergence,essay,monitor}-point/{id}`) answer 403 for a mismatched id, which is what makes type auto-detection possible. Monitor points are the exception to "one point, one call": their endpoint reports only `current_status`, so `get_point` also fetches `/v1/monitor-point/{id}/comments` for the full status history.

## Conventions

- Tool descriptions are dense — the LLM reads them as context. Explain what, when, and what it returns.
- Zod schemas use only fields the user would reasonably set. API-internal fields (e.g. `approved`) get hardcoded defaults.
- All API errors propagate status codes: 401 (bad token), 403 (no permission), 422 (invalid body), 429 (rate limit).
- Strateegia API base: `https://api.strateegia.digital/projects`. Swagger: `https://api.strateegia.digital/projects/swagger-ui/index.html`.
- Never log or store the Authorization header value.
