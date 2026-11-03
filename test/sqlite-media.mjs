import path from "node:path";
import { Kysely } from "kysely";

export async function createMediaDatabase(directory, rows = []) {
	const databasePath = path.join(directory, "maintenance.db");
	const [{ createDialect }, { runMigrations }] = await Promise.all([
		import("emdash/db/sqlite"),
		import("emdash/db"),
	]);
	const database = new Kysely({ dialect: createDialect({ url: databasePath }) });
	try {
		await runMigrations(database);
		if (rows.length) {
			await database.insertInto("media").values(rows.map((row) => ({
				id: row.id,
				filename: row.filename ?? `${row.id}.png`,
				mime_type: row.mime_type ?? "image/png",
				size: row.size ?? null,
				storage_key: row.storage_key,
				content_hash: row.content_hash ?? null,
				width: row.width ?? null,
				height: row.height ?? null,
				blurhash: row.blurhash ?? null,
				dominant_color: row.dominant_color ?? null,
				status: row.status ?? "ready",
			}))).execute();
		}
		return { database, databasePath };
	} catch (error) {
		await database.destroy();
		throw error;
	}
}
