import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strateegiaFetch, apiErrorToMcpResult } from "../strateegia-client.js";

export function registerCommentTools(server: McpServer, getToken: () => string) {
	server.tool(
		"add_question_to_divergence_point",
		"Adds a new question to an existing divergence point (ponto de debate). Use this to expand a debate point with additional questions after creation. Get the divergence_point_id from get_map or from the create_divergence_point response.",
		{
			divergence_point_id: z.string().describe("Divergence point UUID"),
			question: z.string().min(3).max(1000).describe("Question text"),
		},
		async ({ divergence_point_id, question }) => {
			try {
				const data = await strateegiaFetch(
					getToken(),
					`/v1/divergence-point/${divergence_point_id}/question`,
					{
						method: "POST",
						body: JSON.stringify({ question }),
					},
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"add_comment_to_question",
		"Adds a comment (response/idea — resposta) to a question in a divergence point (ponto de debate). This is how participants contribute ideas in brainstorming and discussions. Creates a top-level response; use reply_to_comment to respond to an existing response. Get the divergence_point_id and question_id from get_map.",
		{
			divergence_point_id: z.string().describe("Divergence point UUID"),
			question_id: z.string().describe("Question UUID within the divergence point"),
			text: z.string().min(1).describe("Comment text"),
		},
		async ({ divergence_point_id, question_id, text }) => {
			try {
				const data = await strateegiaFetch(
					getToken(),
					`/v1/divergence-point/${divergence_point_id}/question/${question_id}/comment`,
					{
						method: "POST",
						body: JSON.stringify({ text }),
					},
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"like_comment",
		"Likes (curtir / agreement) a response posted in a divergence point (ponto de debate). Use this to mark agreement with an existing response. The comment_id refers to a top-level response or a reply; get it from the comments array in get_map or from the response of add_comment_to_question / reply_to_comment. Returns the updated comment with the new agreement count.",
		{
			comment_id: z.string().describe("Question comment UUID (the response being liked)"),
		},
		async ({ comment_id }) => {
			try {
				const data = await strateegiaFetch(
					getToken(),
					`/v1/question/comment/${comment_id}/agreement`,
					{
						method: "POST",
						body: "{}",
					},
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"unlike_comment",
		"Removes a previously given like (descurtir) from a response in a divergence point (ponto de debate). Only removes the agreement of the authenticated user. Returns the updated comment with the decremented agreement count.",
		{
			comment_id: z.string().describe("Question comment UUID (the response being unliked)"),
		},
		async ({ comment_id }) => {
			try {
				const data = await strateegiaFetch(
					getToken(),
					`/v1/question/comment/${comment_id}/agreement`,
					{ method: "DELETE" },
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);

	server.tool(
		"reply_to_comment",
		"Replies to an existing response (comentar uma resposta) in a divergence point (ponto de debate), creating a nested comment below it. Use this when the intent is to respond to what someone already said; use add_comment_to_question instead to post a new top-level response to the question itself. Get the comment_id from get_map or from the response of add_comment_to_question.",
		{
			comment_id: z.string().describe("Question comment UUID (the response being replied to)"),
			text: z.string().min(1).describe("Reply text"),
		},
		async ({ comment_id, text }) => {
			try {
				const data = await strateegiaFetch(
					getToken(),
					`/v1/question/comment/${comment_id}/reply`,
					{
						method: "POST",
						body: JSON.stringify({ text }),
					},
				);
				return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
			} catch (err) {
				return apiErrorToMcpResult(err);
			}
		},
	);
}
