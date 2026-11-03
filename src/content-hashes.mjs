import { getMediaDatabase } from "./media-database.mjs";

const CONTENT_HASH_BATCH_SIZE = 500;

export async function loadContentHashes(emdash, ids) {
	const uniqueIds = [];
	const seenIds = new Set();
	if (ids != null) {
		for (const id of ids) {
			if (typeof id !== "string" || id.length === 0 || seenIds.has(id)) continue;
			seenIds.add(id);
			uniqueIds.push(id);
		}
	}

	if (uniqueIds.length === 0) return new Map();

	const database = await getMediaDatabase(emdash);
	if (!database) return new Map();

	const contentHashes = new Map();
	for (let offset = 0; offset < uniqueIds.length; offset += CONTENT_HASH_BATCH_SIZE) {
		const batch = uniqueIds.slice(offset, offset + CONTENT_HASH_BATCH_SIZE);
		const rows = await database
			.selectFrom("media")
			.select(["id", "content_hash"])
			.where("id", "in", batch)
			.where("status", "=", "ready")
			.execute();

		for (const row of rows) {
			if (typeof row.content_hash === "string" && row.content_hash.trim().length > 0) {
				contentHashes.set(row.id, row.content_hash);
			}
		}
	}

	return contentHashes;
}
