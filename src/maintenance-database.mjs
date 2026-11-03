import { stat } from "node:fs/promises";
import path from "node:path";
import { Kysely } from "kysely";

function selectedDatabaseUrl(env) {
	const variable = env.DATABASE_URL ? "DATABASE_URL" : env.EMDASH_DATABASE_URL ? "EMDASH_DATABASE_URL" : undefined;
	if (variable === undefined) return undefined;

	const connectionString = env[variable];
	const match = typeof connectionString === "string"
		? /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(connectionString)
		: undefined;
	return {
		variable,
		connectionString,
		scheme: match?.[1]?.toLowerCase(),
		rest: match ? connectionString.slice(match[0].length) : undefined,
		reportedScheme: match?.[1] ?? "unknown",
	};
}

export function databaseSettings(env = process.env, cwd = process.cwd()) {
	const selectedUrl = selectedDatabaseUrl(env);
	if (selectedUrl) {
		const { connectionString, scheme, rest, reportedScheme } = selectedUrl;
		if (scheme === "file") {
			return { dialect: "sqlite", path: path.resolve(cwd, rest) };
		}
		if (scheme === "postgres" || scheme === "postgresql") {
			return { dialect: "postgres", config: { connectionString } };
		}
		throw new Error(`Unsupported database URL scheme "${reportedScheme}"; supported databases are file: for SQLite and postgres:/postgresql: for PostgreSQL.`);
	}

	if (env.PGHOST && env.PGDATABASE && env.PGUSER) {
		return {
			dialect: "postgres",
			config: {
				host: env.PGHOST,
				port: Number(env.PGPORT || 5432),
				database: env.PGDATABASE,
				user: env.PGUSER,
				password: env.PGPASSWORD,
			},
		};
	}

	throw new Error("Set DATABASE_URL to a file: SQLite URL or a postgres:/postgresql: URL, or set the PGHOST, PGDATABASE, and PGUSER variables.");
}

export function resolveDatabaseEnvironment(env = process.env, cwd = process.cwd()) {
	const selectedUrl = selectedDatabaseUrl(env);
	if (selectedUrl?.scheme !== "file") return env;

	return {
		...env,
		[selectedUrl.variable]: `file:${path.resolve(cwd, selectedUrl.rest)}`,
	};
}

export async function openMaintenanceDatabase(env = process.env) {
	const settings = databaseSettings(env);
	let createDialect;
	let dialectConfig;
	if (settings.dialect === "sqlite") {
		let info;
		try {
			info = await stat(settings.path);
		} catch {
			throw new Error(`SQLite database file does not exist or is not a regular file: ${settings.path}`);
		}
		if (!info.isFile()) {
			throw new Error(`SQLite database path is not a regular file: ${settings.path}`);
		}
		({ createDialect } = await import("emdash/db/sqlite"));
		dialectConfig = { url: settings.path };
	} else {
		({ createDialect } = await import("emdash/db/postgres"));
		dialectConfig = settings.config;
	}
	return new Kysely({ dialect: createDialect(dialectConfig) });
}

export async function maintenanceDatabase({ database, pool, env = process.env } = {}) {
	if (pool !== undefined) {
		throw new TypeError("database must be used instead of the removed pool option.");
	}
	if (database !== undefined) {
		if (typeof database?.selectFrom !== "function") {
			throw new TypeError("database must provide a selectFrom function.");
		}
		return { database, close: async () => undefined };
	}
	const openedDatabase = await openMaintenanceDatabase(env);
	return { database: openedDatabase, close: () => openedDatabase.destroy() };
}
