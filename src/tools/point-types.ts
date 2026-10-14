import { strateegiaFetch, StrateegiaApiError, toolError, type ToolErrorResult } from "../strateegia-client.js";

/** Per-type GET routes. A wrong-type id returns 403, so these can be probed to detect the type. */
export const POINT_ROUTES = {
	DIVERGENCE: "divergence-point",
	CONVERGENCE: "convergence-point",
	ESSAY: "essay-point",
	MONITOR: "monitor-point",
	CHECKPOINT: "checkpoint",
	NOTICE: "notice-point",
} as const;

export type PointType = keyof typeof POINT_ROUTES;
export type Dict = Record<string, unknown>;

export interface ResolvedPoint {
	type: PointType;
	/** Base route of the point, e.g. /v1/checkpoint/{id} */
	route: string;
	data: Dict;
}

/**
 * Reads a point and finds its type. With point_type the matching route is read directly;
 * without it, every candidate route is probed at once and the one answering 2xx wins.
 * Returns a tool error (not an exception) when the point cannot be found as any candidate.
 */
export async function resolvePoint(
	token: string,
	pointId: string,
	pointType: PointType | undefined,
	candidates: readonly PointType[],
	notFound: string,
): Promise<ResolvedPoint | ToolErrorResult> {
	const read = async (type: PointType): Promise<ResolvedPoint> => {
		const route = `/v1/${POINT_ROUTES[type]}/${pointId}`;
		return { type, route, data: (await strateegiaFetch(token, route)) as Dict };
	};

	if (pointType) {
		try {
			return await read(pointType);
		} catch (err) {
			// A mismatched type also answers 403, so point the caller at auto-detection.
			if (err instanceof StrateegiaApiError && err.status === 403) {
				return toolError(`Could not read point ${pointId} as ${pointType} (403). Either the point is a different type (retry without point_type to auto-detect) or the authenticated user has no access to it.`);
			}
			throw err;
		}
	}

	const settled = await Promise.allSettled(candidates.map(read));
	const hit = settled.find((r) => r.status === "fulfilled");
	if (hit && hit.status === "fulfilled") return hit.value;

	// A wrong type answers 403/404; anything else (401, 429, 5xx) is a real failure.
	const failure = settled
		.map((r) => (r.status === "rejected" ? r.reason : null))
		.find((e) => e instanceof StrateegiaApiError && e.status !== 403 && e.status !== 404);
	if (failure) throw failure;
	return toolError(notFound);
}

export const isToolError = (v: unknown): v is ToolErrorResult =>
	typeof v === "object" && v !== null && (v as Dict).isError === true;
