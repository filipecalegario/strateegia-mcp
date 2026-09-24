import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp";
import { exchangeApiKeyForJwt, StrateegiaApiError } from "./strateegia-client.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerMapTools } from "./tools/maps.js";
import { registerPointTools } from "./tools/points.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerToolTemplateTools } from "./tools/tool-templates.js";

/**
 * Builds a fresh server for one request. MCP 2026-07-28 is stateless: there is no
 * session to hang state on, so the JWT arrives with each request (via `authInfo`)
 * and the tools close over it.
 */
function buildServer(jwt: string): McpServer {
	const server = new McpServer(
		{ name: "strateegia-mcp", version: "2.0.0" },
		{
			// The tool list and server identity are the same for every user and carry no
			// personal data, so shared caches may keep them. Five minutes keeps a newly
			// deployed tool from staying invisible for long.
			cacheHints: {
				"tools/list": { ttlMs: 5 * 60_000, cacheScope: "public" },
				"server/discover": { ttlMs: 5 * 60_000, cacheScope: "public" },
			},
		},
	);
	const getToken = () => jwt;
	registerProjectTools(server, getToken);
	registerMapTools(server, getToken);
	registerPointTools(server, getToken);
	registerCommentTools(server, getToken);
	registerToolTemplateTools(server, getToken);
	return server;
}

/**
 * Serves 2026-07-28 clients per request and, through the default `legacy: "stateless"`
 * posture, 2025-era clients (such as the mcp-remote bridge in the .mcpb) without sessions.
 * Origin checking already happens in the entrypoint below, so the handler's own
 * allowlist (localhost and workers.dev only) is opened to avoid rejecting legitimate
 * browser-based clients.
 */
const mcpHandler = createMcpHandler(({ authInfo }) => buildServer(authInfo?.token ?? ""), {
	route: "/mcp",
	allowedOriginHostnames: "*",
});

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/*
 * Auth failure responses. This server authenticates with a Strateegia API key, not
 * OAuth, and the status code decides what a client does next. Measured against
 * mcp-remote 0.14.3: on any 401 it starts OAuth discovery, tries Dynamic Client
 * Registration, gets a 404 and exits with "Dynamic Client Registration rejected",
 * hiding our message; a WWW-Authenticate header does not stop it. On a 403 it skips
 * OAuth and surfaces our message as-is. So:
 *   - no Authorization header at all: 401 (textbook missing credentials);
 *   - a header whose key is empty or rejected: 403, since the client did send a
 *     credential and OAuth cannot help;
 *   - OAuth discovery routes: a JSON error explaining that no OAuth exists here.
 */
const KEY_HELP =
	"Configure the header Authorization: Bearer <Strateegia API key>. Create a key at https://app.strateegia.digital (Settings > API Keys).";

function missingCredentials(): Response {
	const res = jsonResponse(401, {
		error: `Missing Authorization header. ${KEY_HELP}`,
	});
	res.headers.set(
		"WWW-Authenticate",
		'Bearer realm="strateegia-mcp", error="invalid_request", error_description="Send the Strateegia API key as a Bearer token"',
	);
	return res;
}

function rejectedCredentials(detail: string): Response {
	return jsonResponse(403, { error: `${detail} ${KEY_HELP}` });
}

const OAUTH_DISCOVERY_PATHS = ["/register", "/authorize", "/token"];

function isOAuthDiscovery(pathname: string): boolean {
	return pathname.startsWith("/.well-known/") || OAUTH_DISCOVERY_PATHS.includes(pathname);
}

function isPrivateOrigin(origin: string): boolean {
	try {
		const host = new URL(origin).hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "[::1]" ||
			host.endsWith(".local") ||
			/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)
		);
	} catch {
		return true; // Malformed origin: reject
	}
}

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			// --- Auth check ---
			const authHeader = request.headers.get("Authorization");
			if (!authHeader) return missingCredentials();
			// Header values arrive trimmed, so an empty key shows up as a bare "Bearer".
			const apiKey = /^Bearer\s+(\S.*)$/i.exec(authHeader)?.[1]?.trim();
			if (!apiKey) {
				return rejectedCredentials(
					"The Authorization header has no API key (expected: Bearer <api_key>).",
				);
			}

			// --- Origin validation (MCP Streamable HTTP spec: prevent DNS rebinding) ---
			const origin = request.headers.get("Origin");
			if (origin && isPrivateOrigin(origin)) {
				return jsonResponse(403, { error: "Forbidden: private network origin" });
			}

			// --- Exchange the API key for a JWT before any MCP processing ---
			let jwt: string;
			try {
				jwt = await exchangeApiKeyForJwt(apiKey);
			} catch (err) {
				if (err instanceof StrateegiaApiError && err.status !== 401 && err.status !== 403) {
					// Rate limits and upstream outages are not "your key is wrong".
					return jsonResponse(err.status, {
						error: `Strateegia rejected the token exchange (HTTP ${err.status})`,
					});
				}
				return rejectedCredentials(
					"Invalid API key: Strateegia would not issue an access token for it.",
				);
			}

			// The JWT travels as request-scoped authInfo; nothing is stored between requests.
			const authInfo: AuthInfo = { token: jwt, clientId: "strateegia-api-key", scopes: [] };
			return mcpHandler.fetch(request, { authInfo });
		}

		// Clients that meet a 401 look for OAuth here; say plainly that there is none.
		if (isOAuthDiscovery(url.pathname)) {
			return jsonResponse(404, {
				error: "invalid_request",
				error_description: `This MCP server does not use OAuth. ${KEY_HELP}`,
			});
		}

		// Health check / discovery
		if (url.pathname === "/") {
			return jsonResponse(200, {
				name: "strateegia-mcp",
				version: "2.0.0",
				mcp_endpoint: "/mcp",
				protocol: "2026-07-28 (stateless; 2025-era clients served via legacy fallback)",
				docs: "https://api.strateegia.digital/projects/swagger-ui/index.html",
			});
		}

		return new Response("Not found", { status: 404 });
	},
};
