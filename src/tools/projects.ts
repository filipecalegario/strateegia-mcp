import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ADDITIVE, READ_ONLY } from "./annotations.js";
import { strateegiaFetch, apiErrorToMcpResult } from "../strateegia-client.js";

const COLORS = ["PURPLE", "BLUE", "TEAL", "ORANGE", "MAGENTA", "PINK", "YELLOW"] as const;

export function registerProjectTools(server: McpServer, getToken: () => string) {
	server.registerTool(
		"list_projects",
		{
			description: "Lists projects (jornadas) accessible to the authenticated user. A project is called 'jornada' in Portuguese Strateegia UI. Returns paginated results (content[], total_pages, total_elements). Each project has id, title, color, lab info. Start here to explore the workspace.",
			annotations: READ_ONLY,
			inputSchema: z.object({
				page: z.number().int().min(0).default(0).describe("Zero-based page index"),
				size: z.number().int().min(1).max(100).default(20).describe("Page size"),
			}),
		},
		async ({ page, size }) => {
			try {
				const data = await strateegiaFetch(
					getToken(),
					`/v1/project?page=${page}&size=${size}&sort=created_at,desc`,
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.registerTool(
		"get_project",
		{
			description: "Gets full project details: members, maps, connection links, color, visibility, lab. The maps array shows all journey maps in this project — use their ids with get_map or list_maps_in_project.",
			annotations: READ_ONLY,
			inputSchema: z.object({
				project_id: z.string().describe("Project UUID"),
			}),
		},
		async ({ project_id }) => {
			try {
				const data = await strateegiaFetch(getToken(), `/v1/project/${project_id}`);
				return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.registerTool(
		"create_project",
		{
			description: "Creates a new project inside a lab. The lab_owner_id is the lab UUID where the project lives. Colors: PURPLE, BLUE, TEAL, ORANGE, MAGENTA, PINK, YELLOW. Returns the created project with its id.",
			annotations: ADDITIVE,
			inputSchema: z.object({
				title: z.string().min(3).max(100).describe("Project title"),
				lab_owner_id: z.string().describe("Lab UUID that owns this project"),
				color: z.enum(COLORS).describe("Project color"),
				description: z.string().max(300).optional().describe("Project description"),
			}),
		},
		async ({ title, lab_owner_id, color, description }) => {
			try {
				const body: Record<string, unknown> = { title, lab_owner_id, color };
				if (description !== undefined) body.description = description;
				const data = await strateegiaFetch(getToken(), "/v1/project", {
					method: "POST",
					body: JSON.stringify(body),
				});
				return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
