import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strateegiaFetch, apiErrorToMcpResult, StrateegiaApiError } from "../strateegia-client.js";

/** Per-type GET routes. A wrong-type id returns 403, so these can be probed to detect the type. */
const POINT_ENDPOINTS = {
	DIVERGENCE: "divergence-point",
	CONVERGENCE: "convergence-point",
	ESSAY: "essay-point",
	MONITOR: "monitor-point",
} as const;

type PointType = keyof typeof POINT_ENDPOINTS;

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
		"get_point",
		"Gets one point in full by its id, for any type (divergence, convergence, essay, monitor). Use this instead of get_map when you already know which point you want — it returns a couple of KB rather than the whole map, which can run to megabytes. If point_type is omitted the type is detected automatically by probing the per-type routes, so passing it (when known, e.g. from get_map) saves requests. For monitor points the measurement history is fetched separately and attached as `statuses`, since the point endpoint alone only reports `current_status`. Participant content (responses, answers, comments) is NOT included — it is paginated behind its own endpoints.",
		{
			point_id: z.string().describe("Point UUID (any type)"),
			point_type: z
				.enum(["DIVERGENCE", "CONVERGENCE", "ESSAY", "MONITOR"])
				.optional()
				.describe("Point type, if known — skips auto-detection"),
		},
		async ({ point_id, point_type }) => {
			try {
				const token = getToken();
				const fetchAs = async (type: PointType) => ({
					type,
					data: await strateegiaFetch(token, `/v1/${POINT_ENDPOINTS[type]}/${point_id}`),
				});

				let resolved: { type: PointType; data: unknown };
				if (point_type) {
					try {
						resolved = await fetchAs(point_type);
					} catch (err) {
						// A mismatched type also answers 403, so point the caller at auto-detection.
						if (err instanceof StrateegiaApiError && err.status === 403) {
							return {
								content: [
									{
										type: "text" as const,
										text: `Could not read point ${point_id} as ${point_type} (403). Either the point is a different type — retry without point_type to auto-detect — or the authenticated user has no access to it.`,
									},
								],
							};
						}
						throw err;
					}
				} else {
					// Probe every route at once; only the matching type returns 2xx.
					const types = Object.keys(POINT_ENDPOINTS) as PointType[];
					const settled = await Promise.allSettled(types.map(fetchAs));
					const hit = settled.find((r) => r.status === "fulfilled");
					if (!hit || hit.status !== "fulfilled") {
						// A wrong type answers 403/404; anything else (401, 429, 5xx) is a real
						// failure and must surface instead of being reported as "not found".
						const failure = settled
							.map((r) => (r.status === "rejected" ? r.reason : null))
							.find(
								(e) => e instanceof StrateegiaApiError && e.status !== 403 && e.status !== 404,
							);
						if (failure) throw failure;
						return {
							content: [
								{
									type: "text" as const,
									text: `No point found with id ${point_id}. It may not exist, or the authenticated user may not have access to it.`,
								},
							],
						};
					}
					resolved = hit.value;
				}

				const point: Record<string, unknown> = {
					point_type: resolved.type,
					...(resolved.data as Record<string, unknown>),
				};

				// The monitor endpoint omits the status history; /comments returns it.
				if (resolved.type === "MONITOR") {
					try {
						point.statuses = await strateegiaFetch(
							token,
							`/v1/monitor-point/${point_id}/comments`,
						);
					} catch {
						point.statuses = "unavailable (could not load status history)";
					}
				}

				return { content: [{ type: "text" as const, text: JSON.stringify(point, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"create_divergence_point",
		"Creates a divergence point (ponto de debate) — for collecting ideas and responses from participants (brainstorming, discussion). Also called 'debate point' in Portuguese Strateegia UI. Two modes: (A) pass custom questions directly and a tool template is created automatically, or (B) pass a tool_id from an existing template (use list_tool_templates to find one). Mode A is recommended for most cases.",
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
			color: z
				.enum(["PURPLE", "BLUE", "TEAL", "ORANGE", "MAGENTA", "PINK", "YELLOW"])
				.default("BLUE")
				.describe("Color for the auto-created tool template (mode A only). Ignored in mode B."),
			visible: z.boolean().default(true).describe("Whether the point is visible to participants"),
			introduction: z
				.string()
				.min(3)
				.max(20000)
				.optional()
				.describe("Introductory text shown to participants"),
		},
		async ({ map_id, title, position, questions, tool_id, color, visible, introduction }) => {
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
						color,
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
		"Updates an existing divergence point (ponto de debate). Pass only the fields you want to change — title, introduction, and/or visibility. Each field triggers a separate PATCH call to the API.",
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
		"Creates a convergence point (ponto de decisao) — for collaborative group decision-making via polls. Also called 'decision point' in Portuguese Strateegia UI. Define questions with options that participants vote on. Each question must have at least one option. Set a closing_date (ISO 8601) for when voting ends.",
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
		"Creates an essay point (ponto de avaliacao) — for long-form text responses and optional peer evaluation. Also called 'evaluation point' in Portuguese Strateegia UI. Participants write on a theme. Types: ESSAY (free writing), CHALLENGING_SITUATION (scenario analysis), SUBJECTIVE_QUESTION (open question). Set evaluation modes to enable peer review.",
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
		"Creates a monitor point (ponto de monitoramento) — for tracking progress and performance indicators. Also called 'monitoring point' in Portuguese Strateegia UI. QUALITATIVE: team reports status (IN_PROGRESS/SUSPENDED/COMPLETED). QUANTITATIVE: tracks a numeric metric toward a goal (set goal, type, and flow direction UP or DOWN).",
		{
			map_id: z.string().describe("Map UUID"),
			name: z.string().min(3).max(100).describe("Point title"),
			description: z.string().min(3).max(1000).describe("What is being monitored"),
			position: positionSchema,
			conclusion_date: z.string().describe("Monitoring deadline (ISO 8601)"),
			monitor_type: z
				.enum(["QUALITATIVE", "QUANTITATIVE"])
				.describe("QUALITATIVE=status tracking, QUANTITATIVE=numeric metric"),
			goal: z.number().optional().describe("Target numeric value (required for QUANTITATIVE)"),
			type: z
				.enum(["CUMULATIVE", "RECURRING"])
				.optional()
				.describe("Metric aggregation type (required for QUANTITATIVE). CUMULATIVE=values sum over time — use for counts, volumes, R$ totals (e.g. number of contracts, R$ securitized). RECURRING=value is re-measured each period and compared to the goal — use for rates, averages, percentages (e.g. % adoption, average time, CSAT, default rate, NPS)."),
			flow: z
				.enum(["UP", "DOWN"])
				.optional()
				.describe("Goal direction: UP=higher is better (mapped to INCREASING), DOWN=lower is better (mapped to DECREASING). Required for QUANTITATIVE."),
		},
		async ({ map_id, name, description, position, conclusion_date, monitor_type, goal, type, flow }) => {
			try {
				const body: Record<string, unknown> = {
					name,
					description,
					position,
					conclusion_date,
					monitor_type: monitor_type.toLowerCase(),
				};
				if (monitor_type === "QUANTITATIVE") {
					body.goal = goal;
					body.type = type;
					body.flow = flow === "UP" ? "INCREASING" : flow === "DOWN" ? "DECREASING" : undefined;
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

	server.tool(
		"add_monitor_status",
		"Records a measurement (status) on an existing monitor point (ponto de monitoramento), appending one entry to its tracking history — the way progress is logged over time in the Strateegia UI. The value type determines the monitor kind: pass a NUMBER for QUANTITATIVE monitors (the value measured this period, compared against the point's goal/flow), or one of IN_PROGRESS / SUSPENDED / COMPLETED for QUALITATIVE monitors (the reported state). Optionally attach a message explaining the measurement (e.g. the cause of a delay). Use get_map to find the monitor_point_id and to confirm whether the point is quantitative or qualitative.",
		{
			monitor_point_id: z.string().describe("Monitor point UUID (find it via get_map)"),
			value: z
				.union([z.enum(["IN_PROGRESS", "SUSPENDED", "COMPLETED"]), z.number()])
				.describe(
					"The measurement. For QUANTITATIVE monitors: the numeric value measured this period. For QUALITATIVE monitors: one of IN_PROGRESS, SUSPENDED, COMPLETED.",
				),
			message: z.string().optional().describe("Optional note explaining this measurement"),
		},
		async ({ monitor_point_id, value, message }) => {
			try {
				const monitor_type = typeof value === "number" ? "quantitative" : "qualitative";
				const body: Record<string, unknown> = { monitor_type, value };
				if (message !== undefined) body.message = message;
				const data = await strateegiaFetch(
					getToken(),
					`/v1/monitor-point/${monitor_point_id}/status`,
					{
						method: "PATCH",
						body: JSON.stringify(body),
					},
				);
				return {
					content: [
						{
							type: "text" as const,
							text: data ? JSON.stringify(data, null, 2) : `Status added to monitor ${monitor_point_id}`,
						},
					],
				};
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"update_point_position",
		"Updates the position of any point (divergence, convergence, essay, or monitor) on a map. Pass the new row and col in the map grid. Works for all point types — the endpoint is point-type agnostic.",
		{
			map_id: z.string().describe("Map UUID"),
			point_id: z.string().describe("Point UUID (any point type)"),
			row: z.number().int().describe("New row in the map grid"),
			col: z.number().int().describe("New column in the map grid"),
		},
		async ({ map_id, point_id, row, col }) => {
			try {
				const data = await strateegiaFetch(
					getToken(),
					`/v1/map/${map_id}/point/${point_id}/position`,
					{
						method: "PATCH",
						body: JSON.stringify({ row, col }),
					},
				);
				return {
					content: [
						{
							type: "text" as const,
							text: data ? JSON.stringify(data, null, 2) : `Point ${point_id} moved to (row=${row}, col=${col})`,
						},
					],
				};
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
