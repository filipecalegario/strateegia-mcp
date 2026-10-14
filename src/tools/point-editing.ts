import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { IRREVERSIBLE, OVERWRITE } from "./annotations.js";
import { strateegiaFetch, apiErrorToMcpResult, StrateegiaApiError, toolError, toApiDateTime } from "../strateegia-client.js";
import { isToolError, resolvePoint, type Dict, type PointType } from "./point-types.js";

const ALL_TYPES = ["DIVERGENCE", "CONVERGENCE", "ESSAY", "MONITOR", "CHECKPOINT", "NOTICE"] as const;

/** Which point types accept each editable field. */
const FIELD_SUPPORT = {
	title: ["DIVERGENCE", "MONITOR", "NOTICE"],
	description: ["DIVERGENCE", "MONITOR", "CHECKPOINT", "NOTICE"],
	visible: ["DIVERGENCE", "CONVERGENCE", "ESSAY", "MONITOR", "NOTICE"],
	closing_date: ["CONVERGENCE", "ESSAY", "MONITOR"],
	opening_date: ["CHECKPOINT"],
	meeting_place: ["CHECKPOINT"],
	goal: ["MONITOR"],
	color: ["MONITOR"],
	anonymous: ["DIVERGENCE", "ESSAY"],
	individual_mode: ["ESSAY"],
	single_shot_mode: ["ESSAY"],
	end_time_mode: ["ESSAY"],
} as const satisfies Record<string, readonly PointType[]>;

type Field = keyof typeof FIELD_SUPPORT;

/** One API call and the fields it applies. */
interface Step {
	fields: Field[];
	run: () => Promise<unknown>;
}

const supportedFields = (type: PointType) =>
	(Object.keys(FIELD_SUPPORT) as Field[]).filter((f) => (FIELD_SUPPORT[f] as readonly PointType[]).includes(type));

const notFound = (id: string) =>
	`No point found with id ${id}. It may not exist, or the authenticated user may not have access to it.`;

export function registerPointEditingTools(server: McpServer, getToken: () => string) {
	server.registerTool(
		"update_point",
		{
			description: "Updates an existing point of any type: debate (divergence), decision (convergence), essay, monitor, meeting (checkpoint) or notice. Pass only the fields that change; the type is detected automatically (point_type skips detection). Each type accepts a subset of fields: a field the type does not support is rejected before anything is changed, with the list of fields it does support. Several fields may take several API calls; if one fails midway, the error says which fields were already applied. Returns the updated point. To end a decision or a meeting, use close_point instead.",
			annotations: OVERWRITE,
			inputSchema: z.object({
				point_id: z.string().describe("Point UUID (any type)"),
				point_type: z.enum(ALL_TYPES).optional().describe("Point type, if known; skips auto-detection"),
				title: z.string().min(3).max(100).optional().describe("New title (debate, monitor, notice)"),
				description: z
					.string()
					.min(3)
					.max(20000)
					.optional()
					.describe("Main text: a debate's introduction, a monitor's description, a meeting's subject, a notice's announcement"),
				visible: z.boolean().optional().describe("Whether participants see the point (every type except meeting)"),
				closing_date: z
					.string()
					.optional()
					.describe("ISO 8601 with time zone offset; sent to the API in UTC. Closing date of a decision or essay; conclusion date of a monitor. An essay only accepts it while end_time_mode is on: pass end_time_mode: true in the same call if needed"),
				opening_date: z
					.string()
					.optional()
					.describe("Meeting date and time, ISO 8601 with time zone offset (e.g. 2026-10-20T14:00:00-03:00); sent in UTC. Meeting only"),
				meeting_place: z.string().max(500).optional().describe("Address or videoconference link (meeting only)"),
				goal: z.number().optional().describe("Target value of a quantitative monitor"),
				color: z.enum(["PETROLEUM", "COBALT", "PISTACHIO", "TEAL"]).optional().describe("Monitor color in the map"),
				anonymous: z
					.boolean()
					.optional()
					.describe("Anonymous mode of a debate or essay. While on, contributions show no author; turning it off shows the author of every contribution, including those made while it was on. Warn the user before turning it off."),
				individual_mode: z.boolean().optional().describe("Essay: participants see only their own responses"),
				single_shot_mode: z.boolean().optional().describe("Essay: each participant can answer only once"),
				end_time_mode: z.boolean().optional().describe("Essay: answers are accepted only until the closing date. Must be on to set an essay closing_date"),
			}),
		},
		async ({ point_id, point_type, ...changes }) => {
			try {
				const token = getToken();
				// Dates are validated and converted to UTC up front, so a bad date changes nothing.
				if (changes.closing_date !== undefined) changes.closing_date = toApiDateTime(changes.closing_date);
				if (changes.opening_date !== undefined) changes.opening_date = toApiDateTime(changes.opening_date);
				const requested = (Object.keys(changes) as Field[]).filter((f) => changes[f] !== undefined);
				if (requested.length === 0) {
					return toolError("No fields to update. Pass at least one field to change.");
				}

				const resolved = await resolvePoint(token, point_id, point_type, ALL_TYPES, notFound(point_id));
				if (isToolError(resolved)) return resolved;
				const { type, route, data: current } = resolved;

				const unsupported = requested.filter((f) => !(FIELD_SUPPORT[f] as readonly PointType[]).includes(type));
				if (unsupported.length > 0) {
					return toolError(`A ${type} point does not accept: ${unsupported.join(", ")}. Nothing was changed. Fields it accepts: ${supportedFields(type).join(", ")}.`);
				}

				const has = (f: Field) => changes[f] !== undefined;
				const patch = (path: string, body?: Dict) => () =>
					strateegiaFetch(token, `${route}${path}`, {
						method: "PATCH",
						...(body ? { body: JSON.stringify(body) } : {}),
					});
				const toggle = (field: Field, mode: string): Step => ({
					fields: [field],
					run: patch(`/${mode}/${changes[field] ? "enable" : "disable"}`),
				});
				const steps: Step[] = [];

				switch (type) {
					case "DIVERGENCE":
						if (has("title")) steps.push({ fields: ["title"], run: patch("/title", { title: changes.title }) });
						if (has("description"))
							steps.push({ fields: ["description"], run: patch("/introduction", { introduction: changes.description }) });
						if (has("anonymous"))
							steps.push({ fields: ["anonymous"], run: patch("/incognito-mode", { incognito_mode: changes.anonymous }) });
						break;
					case "CONVERGENCE":
						if (has("closing_date"))
							steps.push({ fields: ["closing_date"], run: patch("", { closing_date: changes.closing_date }) });
						break;
					case "ESSAY":
						// Modes go first: the API only accepts a closing date while end_time_mode is on.
						if (has("anonymous")) steps.push(toggle("anonymous", "incognito-mode"));
						if (has("individual_mode")) steps.push(toggle("individual_mode", "individual-mode"));
						if (has("single_shot_mode")) steps.push(toggle("single_shot_mode", "single-shot-mode"));
						if (has("end_time_mode")) steps.push(toggle("end_time_mode", "end-time-mode"));
						if (has("closing_date"))
							steps.push({ fields: ["closing_date"], run: patch("/closing-date", { closing_date: changes.closing_date }) });
						break;
					case "MONITOR": {
						// The monitor PATCH is partial: one call carries every changed attribute.
						const body: Dict = {
							name: changes.title,
							description: changes.description,
							goal: changes.goal,
							conclusion_date: changes.closing_date,
							color: changes.color,
						};
						const fields = (["title", "description", "goal", "closing_date", "color"] as Field[]).filter(has);
						if (fields.length > 0) steps.push({ fields, run: patch("", body) });
						break;
					}
					case "CHECKPOINT": {
						// The meeting PUT replaces the whole point, so unchanged values are sent back as they are.
						const fields = (["description", "opening_date", "meeting_place"] as Field[]).filter(has);
						if (fields.length > 0)
							steps.push({
								fields,
								run: () =>
									strateegiaFetch(token, route, {
										method: "PUT",
										body: JSON.stringify({
											description: changes.description ?? current.description,
											opening_date: changes.opening_date ?? current.opening_date,
											meeting_place: changes.meeting_place ?? current.meeting_place,
										}),
									}),
							});
						break;
					}
					case "NOTICE": {
						// The notice PUT replaces the whole point. send_email stays false so an edit never re-sends the notice.
						const fields = (["title", "description"] as Field[]).filter(has);
						if (fields.length > 0)
							steps.push({
								fields,
								run: () =>
									strateegiaFetch(token, route, {
										method: "PUT",
										body: JSON.stringify({
											title: changes.title ?? current.title,
											description: changes.description ?? current.description,
											send_email: false,
										}),
									}),
							});
						break;
					}
				}
				if (has("visible")) steps.push({ fields: ["visible"], run: patch("/visibility", { visible: changes.visible }) });

				const applied: Field[] = [];
				for (const step of steps) {
					try {
						await step.run();
						applied.push(...step.fields);
					} catch (err) {
						if (applied.length === 0) throw err;
						const reason = err instanceof StrateegiaApiError ? `Error ${err.status}: ${err.body}` : String(err);
						return toolError(`Partially updated ${type} point ${point_id}. Applied: ${applied.join(", ")}. Failed on: ${step.fields.join(", ")} (${reason}). Not attempted: ${steps.slice(steps.indexOf(step) + 1).flatMap((s) => s.fields).join(", ") || "none"}.`);
					}
				}

				const point = await strateegiaFetch(token, route);
				return {
					content: [{ type: "text" as const, text: JSON.stringify({ point_type: type, applied, point }) }],
				};
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.registerTool(
		"close_point",
		{
			description: "Closes a decision point (ponto de decisão, convergence) so it stops receiving votes, or closes a meeting point (checkpoint). This cannot be undone: the platform has no way to reopen a closed point. Only call it when the user explicitly asks to close or end the point; to change a closing date instead, use update_point.",
			annotations: IRREVERSIBLE,
			inputSchema: z.object({
				point_id: z.string().describe("Decision or meeting point UUID"),
				point_type: z.enum(["CONVERGENCE", "CHECKPOINT"]).optional().describe("Point type, if known; skips auto-detection"),
			}),
		},
		async ({ point_id, point_type }) => {
			try {
				const token = getToken();
				const resolved = await resolvePoint(
					token,
					point_id,
					point_type,
					["CONVERGENCE", "CHECKPOINT"],
					`No decision or meeting point found with id ${point_id}. Only decision (convergence) and meeting (checkpoint) points can be closed; the point may also not exist, or the user may not have access to it.`,
				);
				if (isToolError(resolved)) return resolved;

				await strateegiaFetch(token, `${resolved.route}/close`, { method: "PUT" });
				const point = await strateegiaFetch(token, resolved.route);
				return {
					content: [{ type: "text" as const, text: JSON.stringify({ point_type: resolved.type, closed: true, point }) }],
				};
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
