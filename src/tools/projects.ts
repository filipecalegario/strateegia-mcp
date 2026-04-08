import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strateegiaFetch, apiErrorToMcpResult } from "../strateegia-client.js";

const COLORS = ["PURPLE", "BLUE", "TEAL", "ORANGE", "MAGENTA", "PINK", "YELLOW"] as const;

export function registerProjectTools(server: McpServer, getToken: () => string) {
	server.tool(
		"list_projects",
		"Lists projects (jornadas) accessible to the authenticated user. A project is called 'jornada' in Portuguese Strateegia UI. Returns paginated results (content[], total_pages, total_elements). Each project has id, title, color, lab info. Start here to explore the workspace.",
		{
			page: z.number().int().min(0).default(0).describe("Zero-based page index"),
			size: z.number().int().min(1).max(100).default(20).describe("Page size"),
		},
		async ({ page, size }) => {
			try {
				const data = await strateegiaFetch(
					getToken(),
					`/v1/project?page=${page}&size=${size}&sort=created_at,desc`,
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"get_project",
		"Gets full project details: members, maps, connection links, color, visibility, lab. The maps array shows all journey maps in this project — use their ids with get_map or list_maps_in_project.",
		{
			project_id: z.string().describe("Project UUID"),
		},
		async ({ project_id }) => {
			try {
				const data = await strateegiaFetch(getToken(), `/v1/project/${project_id}`);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"create_project",
		"Creates a new project inside a lab. The lab_owner_id is the lab UUID where the project lives. Colors: PURPLE, BLUE, TEAL, ORANGE, MAGENTA, PINK, YELLOW. Returns the created project with its id.",
		{
			title: z.string().min(3).max(100).describe("Project title"),
			lab_owner_id: z.string().describe("Lab UUID that owns this project"),
			color: z.enum(COLORS).describe("Project color"),
			description: z.string().max(300).optional().describe("Project description"),
		},
		async ({ title, lab_owner_id, color, description }) => {
			try {
				const body: Record<string, unknown> = { title, lab_owner_id, color };
				if (description !== undefined) body.description = description;
				const data = await strateegiaFetch(getToken(), "/v1/project", {
					method: "POST",
					body: JSON.stringify(body),
				});
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
