import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strateegiaFetch, apiErrorToMcpResult } from "../strateegia-client.js";

export function registerMapTools(server: McpServer, getToken: () => string) {
	server.tool(
		"create_map",
		"Creates a new journey map inside a project. A map is a visual flow where you add points (divergence, convergence, essay, monitor). Every project needs at least one map before you can add points.",
		{
			project_id: z.string().describe("Project UUID"),
			title: z.string().max(35).default("").describe("Map title (max 35 chars)"),
		},
		async ({ project_id, title }) => {
			try {
				const data = await strateegiaFetch(getToken(), `/v1/project/${project_id}/map`, {
					method: "POST",
					body: JSON.stringify({ title }),
				});
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"list_maps_in_project",
		"Lists all journey maps in a project. Maps are visual flows of connected points (divergence, convergence, essay, monitor). Returns each map's id and metadata. Use get_map to see full structure.",
		{
			project_id: z.string().describe("Project UUID"),
		},
		async ({ project_id }) => {
			try {
				// The API embeds maps in the project response; no dedicated list endpoint
				const data = (await strateegiaFetch(getToken(), `/v1/project/${project_id}`)) as {
					maps?: unknown[];
				};
				const maps = data?.maps ?? [];
				return { content: [{ type: "text" as const, text: JSON.stringify(maps, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"get_map",
		"Gets full map details: all points (divergence, convergence, essay, monitor), their positions on the row/col grid, connections, and content. Use this to understand the map structure before adding points.",
		{
			map_id: z.string().describe("Map UUID"),
		},
		async ({ map_id }) => {
			try {
				const data = await strateegiaFetch(getToken(), `/v1/map/${map_id}/content`);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
