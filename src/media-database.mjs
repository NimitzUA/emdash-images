export async function getMediaDatabase(emdash) {
	const localDatabase = emdash && typeof emdash === "object" ? emdash.db : undefined;
	if (typeof localDatabase?.selectFrom === "function") return localDatabase;

	// EmDash skips database setup for anonymous image requests, so fall back to its configured connection.
	try {
		const { getDb } = await import("emdash/runtime");
		const database = await getDb();
		return typeof database?.selectFrom === "function" ? database : undefined;
	} catch {
		return undefined;
	}
}
