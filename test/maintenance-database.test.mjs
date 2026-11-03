import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { databaseSettings, maintenanceDatabase, openMaintenanceDatabase } from "../src/maintenance-database.mjs";

test("databaseSettings selects supported configurations and rejects credential URLs safely", async (t) => {
	const cwd = path.join(tmpdir(), "maintenance-database-settings");
	const cases = [
		{
			name: "resolves a relative file URL against cwd",
			env: { DATABASE_URL: "file:./data/emdash.db" },
			expected: { dialect: "sqlite", path: path.resolve(cwd, "./data/emdash.db") },
		},
		{
			name: "keeps an absolute file URL absolute",
			env: { DATABASE_URL: "file:/tmp/x.db" },
			expected: { dialect: "sqlite", path: "/tmp/x.db" },
		},
		{
			name: "uses EMDASH_DATABASE_URL when DATABASE_URL is empty",
			env: { DATABASE_URL: "", EMDASH_DATABASE_URL: "file:./fallback.db" },
			expected: { dialect: "sqlite", path: path.resolve(cwd, "fallback.db") },
		},
		{
			name: "selects postgres URLs without parsing or exposing credentials",
			env: { DATABASE_URL: "postgres://user:secret@db.example/emdash" },
			expected: { dialect: "postgres", config: { connectionString: "postgres://user:secret@db.example/emdash" } },
		},
		{
			name: "selects postgresql URLs",
			env: { DATABASE_URL: "postgresql://user:secret@db.example/emdash" },
			expected: { dialect: "postgres", config: { connectionString: "postgresql://user:secret@db.example/emdash" } },
		},
		{
			name: "uses PG variables and defaults the port to 5432",
			env: { PGHOST: "db.example", PGDATABASE: "emdash", PGUSER: "media", PGPASSWORD: "secret" },
			expected: {
				dialect: "postgres",
				config: { host: "db.example", port: 5432, database: "emdash", user: "media", password: "secret" },
			},
		},
		{
			name: "uses an explicit PGPORT",
			env: { PGHOST: "db.example", PGDATABASE: "emdash", PGUSER: "media", PGPORT: "6543" },
			expected: {
				dialect: "postgres",
				config: { host: "db.example", port: 6543, database: "emdash", user: "media", password: undefined },
			},
		},
		{
			name: "reports the supported settings when no database is configured",
			env: {},
			errorIncludes: ["DATABASE_URL", "file:", "PGHOST", "PGDATABASE", "PGUSER"],
		},
		{
			name: "rejects a mysql URL without leaking credentials",
			env: { DATABASE_URL: "mysql://user:secret@db.example/emdash" },
			errorScheme: "mysql",
		},
		{
			name: "rejects a libsql URL without leaking its token",
			env: { DATABASE_URL: "libsql://site.turso.io?authToken=secret" },
			errorScheme: "libsql",
		},
		{
			name: "rejects a D1 URL",
			env: { DATABASE_URL: "d1://binding" },
			errorScheme: "d1",
		},
		{
			name: "rejects an HTTPS URL without leaking credentials",
			env: { DATABASE_URL: "https://user:secret@db.example" },
			errorScheme: "https",
		},
	];

	for (const entry of cases) {
		await t.test(entry.name, () => {
			if (entry.expected) {
				assert.deepEqual(databaseSettings(entry.env, cwd), entry.expected);
				return;
			}
			assert.throws(() => databaseSettings(entry.env, cwd), (error) => {
				if (entry.errorScheme) {
					assert.match(error.message, new RegExp(entry.errorScheme));
					assert.doesNotMatch(error.message, /secret/i);
				}
				for (const part of entry.errorIncludes ?? []) assert.ok(error.message.includes(part), error.message);
				return true;
			});
		});
	}
});

test("openMaintenanceDatabase rejects a missing file without creating it", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "maintenance-database-missing-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const missingPath = path.join(directory, "missing.db");
	await assert.rejects(
		openMaintenanceDatabase({ DATABASE_URL: `file:${missingPath}` }),
		(error) => error.message.includes(missingPath),
	);
	await assert.rejects(lstat(missingPath), { code: "ENOENT" });
});

test("maintenanceDatabase refuses pool and invalid supplied database options", async () => {
	await assert.rejects(
		maintenanceDatabase({ pool: {} }),
		(error) => error instanceof TypeError && /database/.test(error.message),
	);
	await assert.rejects(
		maintenanceDatabase({ database: {} }),
		(error) => error instanceof TypeError && /database/.test(error.message),
	);
});
