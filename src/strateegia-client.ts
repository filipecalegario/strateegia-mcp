import { env } from "cloudflare:workers";

const DEFAULT_API_URL = "https://api.strateegia.digital";

type StrateegiaService = "projects" | "tools" | "users";

/**
 * Base URL of one Strateegia service. STRATEEGIA_API_URL points the worker at another
 * environment (the dev deploy uses https://api.dev.strateegia.digital); the service
 * paths are the same in every environment.
 */
export function serviceUrl(service: StrateegiaService): string {
	const root = (env.STRATEEGIA_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
	return `${root}/${service}`;
}

export class StrateegiaApiError extends Error {
	constructor(
		public status: number,
		public body: string,
	) {
		super(`Strateegia API ${status}: ${body}`);
		this.name = "StrateegiaApiError";
	}
}

/**
 * Exchanges a Strateegia API key (PAT) for a short-lived JWT access token.
 * Called once per incoming MCP request.
 */
export async function exchangeApiKeyForJwt(apiKey: string): Promise<string> {
	const response = await fetch(`${serviceUrl("users")}/v1/auth/api`, {
		method: "POST",
		headers: { "x-api-key": apiKey },
	});

	if (!response.ok) {
		const body = await response.text();
		throw new StrateegiaApiError(response.status, body);
	}

	const data = (await response.json()) as { access_token: string };
	return data.access_token;
}

/**
 * Calls a Strateegia API with the given JWT Bearer token.
 * Defaults to the Projects API; pass service="tools" for the Tools API.
 */
export async function strateegiaFetch(
	bearerToken: string,
	path: string,
	init?: RequestInit,
	service: StrateegiaService = "projects",
): Promise<unknown> {
	const url = `${serviceUrl(service)}${path}`;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${bearerToken}`,
		"Content-Type": "application/json",
		...(init?.headers as Record<string, string>),
	};

	const response = await fetch(url, { ...init, headers });

	if (!response.ok) {
		const body = await response.text();
		throw new StrateegiaApiError(response.status, body);
	}

	if (response.status === 204) return null;
	return response.json();
}

export type ToolErrorResult = { content: { type: "text"; text: string }[]; isError: true };

/**
 * A tool-level failure. `isError: true` tells the model the call failed; without it
 * an API error reads as an ordinary successful result.
 */
export function toolError(text: string): ToolErrorResult {
	return { content: [{ type: "text", text }], isError: true };
}

export function apiErrorToMcpResult(err: unknown): ToolErrorResult {
	if (err instanceof StrateegiaApiError) {
		return toolError(`Error ${err.status}: ${err.body}`);
	}
	const message = err instanceof Error ? err.message : String(err);
	return toolError(`Error: ${message}`);
}
