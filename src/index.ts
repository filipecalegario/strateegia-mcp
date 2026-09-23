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
	const server = new McpServer({ name: "strateegia-mcp", version: "2.0.0" });
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
			if (!authHeader || !authHeader.startsWith("Bearer ")) {
				return jsonResponse(401, {
					error: "Missing or invalid Authorization header. Expected: Bearer <api_key>",
				});
			}

			// --- Origin validation (MCP Streamable HTTP spec: prevent DNS rebinding) ---
			const origin = request.headers.get("Origin");
			if (origin && isPrivateOrigin(origin)) {
				return jsonResponse(403, { error: "Forbidden: private network origin" });
			}

			// --- Exchange the API key for a JWT before any MCP processing ---
			let jwt: string;
			try {
				jwt = await exchangeApiKeyForJwt(authHeader.slice("Bearer ".length).trim());
			} catch (err) {
				if (err instanceof StrateegiaApiError && err.status !== 401 && err.status !== 403) {
					// Rate limits and upstream outages are not "your key is wrong".
					return jsonResponse(err.status, {
						error: `Strateegia rejected the token exchange (HTTP ${err.status})`,
					});
				}
				return jsonResponse(401, {
					error:
						"Invalid API key: Strateegia would not issue an access token. Check the key configured in your MCP client.",
				});
			}

			// The JWT travels as request-scoped authInfo; nothing is stored between requests.
			const authInfo: AuthInfo = { token: jwt, clientId: "strateegia-api-key", scopes: [] };
			return mcpHandler.fetch(request, { authInfo });
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
