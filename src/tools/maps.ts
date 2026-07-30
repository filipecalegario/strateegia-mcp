import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strateegiaFetch, apiErrorToMcpResult } from "../strateegia-client.js";

/**
 * Point containers returned by /v1/map/{id}/content, and the participant-content
 * array each one carries. `notice_points` entries are bare points (no wrapper).
 */
const POINT_CONTAINERS = {
	divergence_points: { kind: "DIVERGENCE", contentKey: "responses" },
	convergence_points: { kind: "CONVERGENCE", contentKey: "answers" },
	essay_points: { kind: "ESSAY", contentKey: "responses" },
	monitor_points: { kind: "MONITOR", contentKey: "comments" },
	checkpoints: { kind: "CHECKPOINT", contentKey: "comments" },
	notice_points: { kind: "NOTICE", contentKey: null },
} as const;

type Dict = Record<string, unknown>;

const asDict = (v: unknown): Dict | null =>
	typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Dict) : null;

const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Divergence points carry their title on the tool template; the others use name/title. */
function pointTitle(point: Dict): unknown {
	return point.name ?? point.title ?? asDict(point.tool)?.title ?? null;
}

/**
 * Collapses map content into an index: one compact row per point, plus counts of
 * the participant content that was left out. Keeps a big map readable in one response.
 */
function summarizeMapContent(content: Dict, map_id: string) {
	const points: Dict[] = [];
	const totals: Dict = {};

	for (const [container, { kind, contentKey }] of Object.entries(POINT_CONTAINERS)) {
		const entries = content[container];
		if (!Array.isArray(entries)) continue;
		totals[kind] = entries.length;

		for (const raw of entries) {
			const entry = asDict(raw);
			if (!entry) continue;
			// notice_points come unwrapped; every other container nests under `point`
			const point = asDict(entry.point) ?? entry;
			const row: Dict = {
				id: point.id,
				type: kind,
				title: pointTitle(point),
				position: point.position,
				visible: point.visible,
			};
			if (contentKey) row[`${contentKey}_count`] = countOf(entry[contentKey]);
			if (kind === "MONITOR") row.statuses_count = countOf(point.statuses);
			points.push(row);
		}
	}

	return {
		map_id,
		detail: "summary",
		note: "Index only — participant content (responses/answers/comments/statuses) omitted. Use get_point for one point in full, or detail='full' for everything.",
		totals,
		points,
	};
}

/** Strips participant content from each entry, keeping the full point configuration. */
function stripContent(content: Dict) {
	const out: Dict = {};
	for (const [container, { contentKey }] of Object.entries(POINT_CONTAINERS)) {
		const entries = content[container];
		if (!Array.isArray(entries)) continue;
		out[container] = entries.map((raw) => {
			const entry = asDict(raw);
			if (!entry) return raw;
			const point = asDict(entry.point);
			if (!point) return entry; // notice_points: nothing nested to strip
			const { statuses, ...restPoint } = point;
			const trimmed: Dict = { point: restPoint };
			if (contentKey) trimmed[`${contentKey}_count`] = countOf(entry[contentKey]);
			if (Array.isArray(statuses)) trimmed.statuses_count = statuses.length;
			return trimmed;
		});
	}
	return out;
}

export function registerMapTools(server: McpServer, getToken: () => string) {
	server.tool(
		"create_map",
		"Creates a new journey map (mapa) inside a project (jornada). A map is a visual flow where you add points: debate (divergence), decision (convergence), evaluation (essay), monitoring (monitor). Every project needs at least one map before you can add points.",
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
		"Gets the points of a journey map (divergence, convergence, essay, monitor, checkpoint, notice) with their positions on the row/col grid. Defaults to a compact index, because a busy map's full content can run to megabytes and exceed client response limits. detail levels: 'summary' (default) = one row per point (id, type, title, position) plus counts of the omitted participant content — start here to find the point you want; 'points' = full configuration of every point (goal, flow, questions, dates...) with participant content still omitted; 'full' = everything including every response, answer, comment and status (can be very large — prefer get_point for a single point).",
		{
			map_id: z.string().describe("Map UUID"),
			detail: z
				.enum(["summary", "points", "full"])
				.default("summary")
				.describe(
					"summary=index of points only (smallest), points=full point config without participant content, full=raw response with all content (largest)",
				),
		},
		async ({ map_id, detail }) => {
			try {
				const data = await strateegiaFetch(getToken(), `/v1/map/${map_id}/content`);
				const content = asDict(data);
				if (!content || detail === "full") {
					return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
				}
				const shaped =
					detail === "summary" ? summarizeMapContent(content, map_id) : stripContent(content);
				return { content: [{ type: "text" as const, text: JSON.stringify(shaped, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
