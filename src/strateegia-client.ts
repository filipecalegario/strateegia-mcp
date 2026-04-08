const BASE_URLS = {
	projects: "https://api.strateegia.digital/projects",
	tools: "https://api.strateegia.digital/tools",
	users: "https://api.strateegia.digital/users",
} as const;

type StrateegiaService = keyof typeof BASE_URLS;

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
	const response = await fetch(`${BASE_URLS.users}/v1/auth/api`, {
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
	const url = `${BASE_URLS[service]}${path}`;
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

export function apiErrorToMcpResult(err: unknown): { content: { type: "text"; text: string }[] } {
	if (err instanceof StrateegiaApiError) {
		return {
			content: [
				{
					type: "text",
					text: `Error ${err.status}: ${err.body}`,
				},
			],
		};
	}
	const message = err instanceof Error ? err.message : String(err);
	return { content: [{ type: "text", text: `Error: ${message}` }] };
}
