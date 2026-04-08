import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { exchangeApiKeyForJwt } from "./strateegia-client.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerMapTools } from "./tools/maps.js";
import { registerPointTools } from "./tools/points.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerToolTemplateTools } from "./tools/tool-templates.js";

export class StrateegiaAgent extends McpAgent<Env> {
	server = new McpServer({
		name: "strateegia-mcp",
		version: "1.0.0",
	});

	/** JWT access token obtained by exchanging the API key. Set per-request. */
	private jwtToken = "";

	async fetch(request: Request): Promise<Response> {
		// Exchange the API key for a JWT before MCP processing.
		// DOs are single-threaded, so storing on `this` is safe.
		const apiKey = request.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
		try {
			this.jwtToken = await exchangeApiKeyForJwt(apiKey);
		} catch {
			return new Response(
				JSON.stringify({ error: "Invalid API key — could not obtain access token from Strateegia" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			);
		}
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
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
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

			return StrateegiaAgent.serve("/mcp").fetch(request, env, ctx);
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
