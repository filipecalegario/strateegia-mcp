import { strateegiaFetch } from "../strateegia-client.js";

export type MapPosition = { row: number; col: number };

/** Same grid the Strateegia web app draws: rows 0 to 16 and columns 0 to 25. */
export const LAST_ROW = 16;
export const LAST_COL = 25;

export const NO_FREE_POSITION =
	"Error: the map has no free position left. Ask the user to free a position or to use another map.";

type MapPoints = { points?: { id?: string; position?: Partial<MapPosition> | null }[] } | null;

const keyOf = ({ row, col }: MapPosition) => `${row}:${col}`;

const isInside = ({ row, col }: MapPosition) => row >= 0 && row <= LAST_ROW && col >= 0 && col <= LAST_COL;

/**
 * The wanted position when it is free and inside the grid, otherwise the nearest free one.
 * Null when every position of the grid is taken.
 */
export function nearestFreePosition(wanted: MapPosition, taken: Set<string>): MapPosition | null {
	if (isInside(wanted) && !taken.has(keyOf(wanted))) return wanted;
	let best: MapPosition | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let row = 0; row <= LAST_ROW; row++) {
		for (let col = 0; col <= LAST_COL; col++) {
			if (taken.has(keyOf({ row, col }))) continue;
			const distance = (row - wanted.row) ** 2 + (col - wanted.col) ** 2;
			if (distance < bestDistance) {
				best = { row, col };
				bestDistance = distance;
			}
		}
	}
	return best;
}

/**
 * Keeps a point off the positions other points already take on the map, so creating or moving it
 * does not fail with "Slot not available". When the map cannot be read, the wanted position is kept
 * and the API decides. ignorePointId leaves out the point being moved.
 */
export async function freePosition(
	token: string,
	mapId: string,
	wanted: MapPosition,
	ignorePointId?: string,
): Promise<MapPosition | null> {
	let map: MapPoints;
	try {
		map = (await strateegiaFetch(token, `/v1/map/${mapId}`)) as MapPoints;
	} catch {
		return wanted;
	}
	const taken = new Set<string>();
	for (const point of map?.points ?? []) {
		const position = point.position;
		if (point.id === ignorePointId || !position) continue;
		if (Number.isInteger(position.row) && Number.isInteger(position.col)) {
			taken.add(keyOf(position as MapPosition));
		}
	}
	return nearestFreePosition(wanted, taken);
}
