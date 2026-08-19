import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { exchangeApiKeyForJwt, StrateegiaApiError } from "./strateegia-client.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerMapTools } from "./tools/maps.js";
import { registerPointTools } from "./tools/points.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerToolTemplateTools } from "./tools/tool-templates.js";

/**
 * Internal header carrying the JWT from the Worker entrypoint to the Durable Object.
 * The entrypoint always overwrites it, so a client cannot inject its own token.
 */
const JWT_HEADER = "X-Strateegia-Jwt";

export class StrateegiaAgent extends McpAgent<Env> {
	server = new McpServer({
		name: "strateegia-mcp",
		version: "1.0.0",
	});

	/** JWT access token obtained by exchanging the API key. Set per-request. */
	private jwtToken = "";

	async fetch(request: Request): Promise<Response> {
		// The entrypoint already exchanged the API key and rejected bad ones — a
		// failure raised in here would surface as a generic transport 500, not a 401.
		// DOs are single-threaded, so storing on `this` is safe.
		this.jwtToken = request.headers.get(JWT_HEADER) ?? "";
		return super.fetch(request);
	}

	async init() {
		const getToken = () => this.jwtToken;
		registerProjectTools(this.server, getToken);
		registerMapTools(this.server, getToken);
		registerPointTools(this.server, getToken);
		registerCommentTools(this.server, getToken);
		registerToolTemplateTools(this.server, getToken);
	}
}

// --- Worker fetch handler ---

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
		return true; // Malformed origin — reject
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			// --- Auth check ---
			const authHeader = request.headers.get("Authorization");
			if (!authHeader || !authHeader.startsWith("Bearer ")) {
				return new Response(
					JSON.stringify({ error: "Missing or invalid Authorization header. Expected: Bearer <api_key>" }),
					{ status: 401, headers: { "Content-Type": "application/json" } },
				);
			}

			// --- Origin validation (MCP Streamable HTTP spec: prevent DNS rebinding) ---
			const origin = request.headers.get("Origin");
			if (origin && isPrivateOrigin(origin)) {
				return new Response(
					JSON.stringify({ error: "Forbidden: private network origin" }),
					{ status: 403, headers: { "Content-Type": "application/json" } },
				);
			}

			// --- Exchange the API key here, at the HTTP layer ---
			// Doing this inside the Durable Object means a rejected key surfaces as a
			// generic transport 500 ("Failed to establish WebSocket connection"), which
			// reads to the user as a server outage rather than a bad key.
			let jwt: string;
			try {
				jwt = await exchangeApiKeyForJwt(authHeader.slice("Bearer ".length).trim());
			} catch (err) {
				if (err instanceof StrateegiaApiError && err.status !== 401 && err.status !== 403) {
					// Rate limits and upstream outages are not "your key is wrong".
					return new Response(
						JSON.stringify({ error: `Strateegia rejected the token exchange (HTTP ${err.status})` }),
						{ status: err.status, headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response(
					JSON.stringify({
						error:
							"Invalid API key — Strateegia would not issue an access token. Check the key configured in your MCP client.",
					}),
					{ status: 401, headers: { "Content-Type": "application/json" } },
				);
			}

			// set() overwrites, so a client-supplied value can never reach the agent.
			const headers = new Headers(request.headers);
			headers.set(JWT_HEADER, jwt);

			return StrateegiaAgent.serve("/mcp").fetch(new Request(request, { headers }), env, ctx);
		}

		// Health check / discovery
		if (url.pathname === "/") {
			return new Response(
				JSON.stringify({
					name: "strateegia-mcp",
					version: "1.0.0",
					mcp_endpoint: "/mcp",
					docs: "https://api.strateegia.digital/projects/swagger-ui/index.html",
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response("Not found", { status: 404 });
	},
};
