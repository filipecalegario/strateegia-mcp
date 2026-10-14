import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { READ_ONLY } from "./annotations.js";
import { strateegiaFetch, apiErrorToMcpResult, toolError } from "../strateegia-client.js";
import { isToolError, resolvePoint, type Dict } from "./point-types.js";

const PARTICIPATION_TYPES = ["DIVERGENCE", "CONVERGENCE", "ESSAY", "MONITOR", "CHECKPOINT", "STATUS"] as const;

/** Spring Page envelope used by the paginated participation endpoints. */
interface SpringPage {
	content: Dict[];
	total_elements: number;
	last: boolean;
}

const countOf = (v: unknown): number | undefined => (Array.isArray(v) ? v.length : undefined);

/** Author reduced to what an LLM needs: the name, and whether an AI assistant wrote it. */
function authorOf(raw: unknown): Dict | null {
	const author = raw as Dict | null;
	if (!author) return null;
	return author.is_assistant ? { name: author.name, is_assistant: true } : { name: author.name };
}

/** Debate and checkpoint comment, without avatars and audit fields. */
function commentOf(c: Dict): Dict {
	return {
		id: c.id,
		author: authorOf(c.author),
		text: c.text,
		created_at: c.created_at,
		reply_count: c.reply_count,
		agreements: countOf(c.agreements),
	};
}

/**
 * Essay response. The AI evaluation feedback is about as long as the essay itself, so only
 * the grade comes by default; the feedback text is opt-in.
 */
function essayResponseOf(r: Dict, withFeedback: boolean): Dict {
	const evaluation = r.evaluation_result as Dict | null;
	return {
		id: r.id,
		author: authorOf(r.author),
		title: r.title,
		text: r.text,
		created_at: r.created_at,
		reply_count: r.reply_count,
		agreements: countOf(r.agreements),
		...(evaluation
			? {
					evaluation: {
						grade: evaluation.base_grade,
						...(withFeedback ? { feedback: evaluation.result } : {}),
					},
				}
			: {}),
	};
}

function monitorStatusOf(s: Dict): Dict {
	return { id: s.id, author: authorOf(s.author), value: s.value, message: s.message, created_at: s.created_at };
}

/**
 * Survey (status point) results: votes per option of each question, counted over finalized
 * responses, plus the page of individual responses with option ids turned into their labels.
 * Respondent ids are dropped: the identified endpoint is for journey staff spreadsheets only.
 */
function surveyResultsOf(questions: Dict[], responses: Dict[], page: number, size: number) {
	const labels = new Map<string, string>();
	const votes = new Map<string, Map<string, number>>();
	const answered = new Map<string, number>();
	for (const q of questions) {
		const counts = new Map<string, number>();
		for (const o of (q.options ?? []) as Dict[]) {
			labels.set(`${q.id}/${o.id}`, o.label as string);
			counts.set(o.id as string, 0);
		}
		votes.set(q.id as string, counts);
	}

	const finalized = responses.filter((r) => r.finalized);
	for (const r of finalized) {
		for (const { answer } of (r.answered_questions ?? []) as { answer: Dict }[]) {
			const qid = answer.question_id as string;
			answered.set(qid, (answered.get(qid) ?? 0) + 1);
			const counts = votes.get(qid);
			for (const id of (answer.selected_option_ids ?? []) as string[]) counts?.set(id, (counts.get(id) ?? 0) + 1);
		}
	}

	const paged = pageOf(finalized, page, size);
	return {
		...paged,
		items: paged.items.map((r) => ({
			answer_id: r.answer_id,
			answers: ((r.answered_questions ?? []) as { answer: Dict }[]).map(({ answer }) => ({
				question_id: answer.question_id,
				choices: ((answer.selected_option_ids ?? []) as string[]).map((id) => labels.get(`${answer.question_id}/${id}`) ?? id),
				...(answer.text ? { text: answer.text } : {}),
			})),
		})),
		questions: questions.map((q) => ({
			question_id: q.id,
			question: q.text,
			answered: answered.get(q.id as string) ?? 0,
			options: ((q.options ?? []) as Dict[]).map((o) => ({
				text: o.label,
				votes: votes.get(q.id as string)?.get(o.id as string) ?? 0,
				...(o.next && o.next !== "END" ? { next_question_id: o.next } : {}),
			})),
		})),
		in_progress: responses.length - finalized.length,
	};
}

/** Pages a plain list locally, for the endpoints that return everything at once. */
function pageOf<T>(list: T[], page: number, size: number) {
	const start = page * size;
	return { items: list.slice(start, start + size), total: list.length, has_more: start + size < list.length };
}

export function registerPointContentTools(server: McpServer, getToken: () => string) {
	server.registerTool(
		"get_point_content",
		{
			description: "Gets what participants produced in one point: debate answers, essay responses, monitoring measurements, meeting (checkpoint) comments, decision (convergence) results or survey (status, ponto de pesquisa) results. Sibling of get_point, which returns the point's configuration but not its participation. Use this to read, summarize or analyze what people said. If point_type is omitted the type is detected automatically. Divergence (ponto de debate): comments are grouped by question, with the question text; pass question_id (from get_point) to read a single question. Convergence (ponto de decisão): returns aggregated votes per option and the number of participants; individual votes are not available. Results are paginated with page (0-based) and size; has_more tells whether another page exists, and for debates page/size apply to each question. Replies to a comment are counted in reply_count but not included. Author is reduced to the name, with is_assistant: true when an AI assistant wrote it. Status (ponto de pesquisa): returns votes per option of every question, counted over finalized responses, plus a page of individual responses (choices as option labels, no respondent identity); in_progress counts responses not yet finalized, and next_question_id shows the branching. Survey results are readable only by journey staff, unless the point shares its results with participants. Essay (ponto de avaliação) responses carry the evaluation grade; the AI evaluation feedback text, about as long as the essay, comes only with include_evaluation_feedback.",
			annotations: READ_ONLY,
			inputSchema: z.object({
				point_id: z.string().describe("Point UUID (any type)"),
				point_type: z
					.enum(PARTICIPATION_TYPES)
					.optional()
					.describe("Point type, if known; skips auto-detection"),
				question_id: z
					.string()
					.optional()
					.describe("Divergence points only: read just this question's comments"),
				page: z.number().int().min(0).default(0).describe("Page number, starting at 0"),
				size: z.number().int().min(1).max(100).default(10).describe("Items per page (per question for debates)"),
				include_evaluation_feedback: z
					.boolean()
					.default(false)
					.describe("Essay points only: include the AI evaluation feedback text of each response"),
			}),
		},
		async ({ point_id, point_type, question_id, page, size, include_evaluation_feedback }) => {
			try {
				const token = getToken();
				const resolved = await resolvePoint(
					token,
					point_id,
					point_type,
					PARTICIPATION_TYPES,
					`No point found with id ${point_id}. It may not exist, it may be a notice point (which has no participation), or the authenticated user may not have access to it.`,
				);
				if (isToolError(resolved)) return resolved;

				const { route } = resolved;
				const envelope = { point_id, point_type: resolved.type, page, size };
				const respond = (body: Dict) => ({
					content: [{ type: "text" as const, text: JSON.stringify({ ...envelope, ...body }) }],
				});

				switch (resolved.type) {
					case "DIVERGENCE": {
						// Comments are only reachable per question, so resolve the questions first.
						const { questions } = (await strateegiaFetch(token, `${route}/question`)) as {
							questions: { id: string; question: string; active: boolean }[];
						};
						const selected = question_id ? questions.filter((q) => q.id === question_id) : questions;
						if (question_id && selected.length === 0) {
							const known = questions.map((q) => `${q.id} ("${q.question}")`).join(", ");
							return toolError(`Question ${question_id} is not part of divergence point ${point_id}. Its questions are: ${known}`);
						}
						const pages = await Promise.all(
							selected.map(
								(q) =>
									strateegiaFetch(token, `${route}/question/${q.id}/comment?page=${page}&size=${size}`) as Promise<SpringPage>,
							),
						);
						return respond({
							items: selected.map((q, i) => ({
								question_id: q.id,
								question: q.question,
								...(q.active === false ? { active: false } : {}),
								total: pages[i].total_elements,
								comments: pages[i].content.map(commentOf),
							})),
							total: pages.reduce((sum, p) => sum + p.total_elements, 0),
							has_more: pages.some((p) => !p.last),
						});
					}
					case "CHECKPOINT": {
						const comments = (await strateegiaFetch(token, `${route}/comment?page=${page}&size=${size}`)) as SpringPage;
						return respond({
							items: comments.content.map(commentOf),
							total: comments.total_elements,
							has_more: !comments.last,
						});
					}
					case "ESSAY": {
						// The responses endpoint ignores paging and returns every response.
						const responses = (await strateegiaFetch(token, `${route}/responses`)) as Dict[];
						const paged = pageOf(responses, page, size);
						return respond({
							...paged,
							items: paged.items.map((r) => essayResponseOf(r, include_evaluation_feedback)),
						});
					}
					case "MONITOR": {
						// /comments carries the measurement history, oldest first.
						const statuses = (await strateegiaFetch(token, `${route}/comments`)) as Dict[];
						const paged = pageOf(statuses, page, size);
						return respond({ ...paged, items: paged.items.map(monitorStatusOf) });
					}
					case "CONVERGENCE": {
						// Aggregated votes live on the point itself; individual votes are not exposed.
						const questions = (resolved.data.questions ?? []) as Dict[];
						return respond({
							items: questions.map((q) => ({
								question_id: q.id,
								question: q.text,
								options: ((q.options ?? []) as Dict[]).map((o) => ({ text: o.text, votes: o.count_vote })),
							})),
							total: resolved.data.answer_count,
							has_more: false,
							allow_multiple_answers: resolved.data.allow_multiple_answers,
							status: resolved.data.status,
						});
					}
					case "STATUS": {
						// Every response comes at once; only finalized ones count, as in the platform's chart.
						const { incognito, responses } = (await strateegiaFetch(token, `${route}/answer/responses`)) as {
							incognito: boolean;
							responses: Dict[];
						};
						return respond({
							...surveyResultsOf((resolved.data.questions ?? []) as Dict[], responses, page, size),
							anonymous: incognito,
							status: resolved.data.status,
						});
					}
					default:
						return toolError(`A ${resolved.type} point has no participation to read.`);
				}
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
