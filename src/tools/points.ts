import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strateegiaFetch, apiErrorToMcpResult } from "../strateegia-client.js";

const positionSchema = z.object({
	row: z.number().int().describe("Row in the map grid"),
	col: z.number().int().describe("Column in the map grid"),
});

const optionSchema = z.object({
	text: z.string().min(1).describe("Option text"),
});

const questionSchema = z.object({
	text: z.string().min(1).describe("Question text"),
	options: z.array(optionSchema).min(1).max(30).describe("Answer options for voting"),
});

export function registerPointTools(server: McpServer, getToken: () => string) {
	server.tool(
		"create_divergence_point",
		"Creates a divergence point — for collecting ideas and responses from participants (brainstorming, discussion). Two modes: (A) pass custom questions directly and a tool template is created automatically, or (B) pass a tool_id from an existing template (use list_tool_templates to find one). Mode A is recommended for most cases.",
		{
			map_id: z.string().describe("Map UUID"),
			title: z.string().min(1).max(100).describe("Point title (also used as tool template name in mode A)"),
			position: positionSchema,
			questions: z
				.array(z.string().min(1))
				.min(1)
				.optional()
				.describe("Custom questions for participants (mode A — creates a tool template automatically)"),
			tool_id: z
				.string()
				.optional()
				.describe("Existing tool template UUID (mode B — use list_tool_templates to find one)"),
			visible: z.boolean().default(true).describe("Whether the point is visible to participants"),
			introduction: z
				.string()
				.min(3)
				.max(20000)
				.optional()
				.describe("Introductory text shown to participants"),
		},
		async ({ map_id, title, position, questions, tool_id, visible, introduction }) => {
			try {
				if (!questions && !tool_id) {
					return {
						content: [{ type: "text" as const, text: "Error: provide either 'questions' (to create a new template) or 'tool_id' (to use an existing template)" }],
					};
				}

				let resolvedToolId = tool_id;

				// Mode A: create a tool template on the fly with the user's questions
				if (questions && !tool_id) {
					const toolBody = {
						title,
						color: "BLUE" as const,
						questions: questions.map((q) => ({ question: q })),
						references: [],
					};
					const tool = (await strateegiaFetch(
						getToken(),
						"/v1/tool",
						{ method: "POST", body: JSON.stringify(toolBody) },
						"tools",
					)) as { id: string };
					resolvedToolId = tool.id;
				}

				const body: Record<string, unknown> = {
					tool_id: resolvedToolId,
					position,
					visible,
					approved: true,
				};
				if (introduction !== undefined) body.introduction = introduction;
				const data = await strateegiaFetch(getToken(), `/v1/map/${map_id}/divergence-point`, {
					method: "POST",
					body: JSON.stringify(body),
				});
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"update_divergence_point",
		"Updates an existing divergence point. Pass only the fields you want to change — title, introduction, and/or visibility. Each field triggers a separate PATCH call to the API.",
		{
			divergence_point_id: z.string().describe("Divergence point UUID"),
			title: z.string().min(3).max(100).optional().describe("New title"),
			introduction: z.string().min(3).max(20000).optional().describe("Introductory text shown to participants"),
			visible: z.boolean().optional().describe("Whether the point is visible to participants"),
		},
		async ({ divergence_point_id, title, introduction, visible }) => {
			try {
				const results: string[] = [];
				const base = `/v1/divergence-point/${divergence_point_id}`;

				if (title !== undefined) {
					await strateegiaFetch(getToken(), `${base}/title`, {
						method: "PATCH",
						body: JSON.stringify({ title }),
					});
					results.push(`title updated to "${title}"`);
				}
				if (introduction !== undefined) {
					await strateegiaFetch(getToken(), `${base}/introduction`, {
						method: "PATCH",
						body: JSON.stringify({ introduction }),
					});
					results.push("introduction updated");
				}
				if (visible !== undefined) {
					await strateegiaFetch(getToken(), `${base}/visibility`, {
						method: "PATCH",
						body: JSON.stringify({ visible }),
					});
					results.push(`visibility set to ${visible}`);
				}

				if (results.length === 0) {
					return { content: [{ type: "text" as const, text: "No fields to update. Pass at least one of: title, introduction, visible." }] };
				}

				// Return the updated point
				const updated = await strateegiaFetch(getToken(), base);
				return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"create_convergence_point",
		"Creates a convergence point — for group decision-making via polls. Define questions with options that participants vote on. Each question must have at least one option. Set a closing_date (ISO 8601) for when voting ends.",
		{
			map_id: z.string().describe("Map UUID"),
			name: z.string().min(1).describe("Point title"),
			position: positionSchema,
			questions: z.array(questionSchema).min(1).max(10).describe("Poll questions with options"),
			closing_date: z.string().describe("Voting deadline (ISO 8601 datetime, e.g. 2025-12-31T23:59:00Z)"),
			visible: z.boolean().default(true).describe("Whether the point is visible to participants"),
			allow_multiple_answers: z
				.boolean()
				.optional()
				.default(false)
				.describe("Allow selecting multiple options per question"),
		},
		async ({ map_id, name, position, questions, closing_date, visible, allow_multiple_answers }) => {
			try {
				const body: Record<string, unknown> = {
					name,
					position,
					questions,
					closing_date,
					visible,
					type: "POLL",
				};
				if (allow_multiple_answers !== undefined) body.allow_multiple_answers = allow_multiple_answers;
				const data = await strateegiaFetch(getToken(), `/v1/map/${map_id}/convergence-point`, {
					method: "POST",
					body: JSON.stringify(body),
				});
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"create_essay_point",
		"Creates an essay point — for long-form text responses and optional peer evaluation. Participants write on a theme. Types: ESSAY (free writing), CHALLENGING_SITUATION (scenario analysis), SUBJECTIVE_QUESTION (open question). Set evaluation modes to enable peer review.",
		{
			map_id: z.string().describe("Map UUID"),
			essay_name: z.string().min(1).describe("Point title"),
			position: positionSchema,
			essay_theme: z.string().min(1).describe("Theme or prompt for the essay"),
			essay_language: z.string().default("PT_BR").describe("Language code: PT_BR, EN_US, DE_DE, ZH_CN, ES_ES, FR_FR"),
			type: z
				.enum(["ESSAY", "CHALLENGING_SITUATION", "SUBJECTIVE_QUESTION"])
				.default("ESSAY")
				.describe("ESSAY=free writing, CHALLENGING_SITUATION=scenario analysis, SUBJECTIVE_QUESTION=open question"),
			visible: z.boolean().default(true).describe("Whether the point is visible"),
			user_evaluation_mode: z.boolean().default(false).describe("Enable peer evaluation of essays"),
			incognito_mode: z.boolean().default(false).describe("Hide author identity"),
			individual_mode: z.boolean().default(false).describe("Participants can only see their own essays"),
			multiple_response_mode: z.boolean().default(false).describe("Allow multiple submissions"),
			support_texts: z.array(z.string()).default([]).describe("Reference texts shown to participants"),
			criteria_ids: z.array(z.string()).default([]).describe("Evaluation criteria UUIDs"),
			closing_date: z.string().optional().describe("Submission deadline (ISO 8601)"),
			thematic: z.string().optional().describe("Thematic category"),
		},
		async ({
			map_id,
			essay_name,
			position,
			essay_theme,
			essay_language,
			type,
			visible,
			user_evaluation_mode,
			incognito_mode,
			individual_mode,
			multiple_response_mode,
			support_texts,
			criteria_ids,
			closing_date,
			thematic,
		}) => {
			try {
				const body: Record<string, unknown> = {
					essay_name,
					position,
					essay_theme,
					essay_language,
					type,
					visible,
					approved: true,
					user_evaluation_mode,
					incognito_mode,
					individual_mode,
					multiple_response_mode,
					support_texts,
					criteria_ids,
					end_time_mode: !!closing_date,
					block_answer_deletion_mode: false,
					hide_evaluation_grade_mode: false,
				};
				if (closing_date) body.closing_date = closing_date;
				if (thematic) body.thematic = thematic;
				const data = await strateegiaFetch(getToken(), `/v1/map/${map_id}/essay-point`, {
					method: "POST",
					body: JSON.stringify(body),
				});
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"create_monitor_point",
		"Creates a monitor point — for tracking progress. QUALITATIVE: team reports status (IN_PROGRESS/SUSPENDED/COMPLETED). QUANTITATIVE: tracks a numeric metric toward a goal (set goal, type label, and flow direction UP or DOWN).",
		{
			map_id: z.string().describe("Map UUID"),
			name: z.string().min(3).max(100).describe("Point title"),
			description: z.string().min(3).max(1000).describe("What is being monitored"),
			position: positionSchema,
			conclusion_date: z.string().describe("Monitoring deadline (ISO 8601)"),
			monitor_type: z
				.enum(["QUALITATIVE", "QUANTITATIVE"])
				.describe("QUALITATIVE=status tracking, QUANTITATIVE=numeric metric"),
			goal: z.number().optional().describe("Target value (required for QUANTITATIVE)"),
			type: z.string().optional().describe("Metric label, e.g. 'Revenue' (required for QUANTITATIVE)"),
			flow: z
				.enum(["UP", "DOWN"])
				.optional()
				.describe("Goal direction: UP=higher is better, DOWN=lower is better (required for QUANTITATIVE)"),
		},
		async ({ map_id, name, description, position, conclusion_date, monitor_type, goal, type, flow }) => {
			try {
				const body: Record<string, unknown> = {
					name,
					description,
					position,
					conclusion_date,
					monitor_type,
				};
				if (monitor_type === "QUANTITATIVE") {
					body.goal = goal;
					body.type = type;
					body.flow = flow;
				}
				const data = await strateegiaFetch(getToken(), `/v1/map/${map_id}/monitor-point`, {
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
