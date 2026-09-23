import type { ToolAnnotations } from "@modelcontextprotocol/server";

/*
 * Risk hints shown to clients (Claude uses them in its permission UI). Every field is
 * set explicitly: when omitted, the MCP defaults are the most cautious ones
 * (destructiveHint: true, openWorldHint: true), which would flag even read-only
 * tools as destructive. openWorldHint is false throughout because every tool talks
 * to one bounded system, the Strateegia API, not the open web.
 */

/** Reads only; changes nothing. */
export const READ_ONLY: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};

/** Adds something new (a project, point, comment, measurement). Repeating it adds it again. */
export const ADDITIVE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};

/** Sets a state that is easy to set back (a position, a like). Repeating it changes nothing. */
export const REVERSIBLE_SET: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};

/** Replaces existing content (a title, an introduction); the previous value is not kept. */
export const OVERWRITE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: false,
};
