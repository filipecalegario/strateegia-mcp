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
		"Adds a comment (response/idea) to a question in a divergence point (ponto de debate). This is how participants contribute ideas in brainstorming and discussions. Get the divergence_point_id and question_id from get_map.",
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
}
