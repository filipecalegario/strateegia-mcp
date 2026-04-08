import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strateegiaFetch, apiErrorToMcpResult } from "../strateegia-client.js";

export function registerToolTemplateTools(server: McpServer, getToken: () => string) {
	server.tool(
		"list_tool_templates",
		"Lists available tool templates for creating divergence points. Returns each template's id, title, description, questions, and color. Use a template id as tool_id in create_divergence_point, or use create_divergence_point with custom questions (which creates a template automatically). Filter by title to search, or set official=true for Strateegia's built-in templates.",
		{
			title: z.string().optional().describe("Search by title"),
			official: z.boolean().optional().default(true).describe("Only official Strateegia templates"),
			page: z.number().int().min(0).default(0).describe("Zero-based page index"),
			size: z.number().int().min(1).max(50).default(20).describe("Page size"),
		},
		async ({ title, official, page, size }) => {
			try {
				const params = new URLSearchParams({ page: String(page), size: String(size) });
				if (title) params.set("title", title);
				if (official !== undefined) params.set("official", String(official));
				const data = await strateegiaFetch(
					getToken(),
					`/v1/tool/explore?${params}`,
					undefined,
					"tools",
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
