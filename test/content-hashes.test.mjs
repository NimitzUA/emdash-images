import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { loadContentHashes } from "../src/content-hashes.mjs";
import { createMediaDatabase } from "./sqlite-media.mjs";

async function makeTestDirectory(t) {
	const directory = await mkdtemp(path.join(tmpdir(), "image-content-hashes-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

async function makeMediaDatabase(t, directory, rows = []) {
	const { database } = await createMediaDatabase(directory, rows);
	t.after(() => database.destroy());
	return database;
}

function sortedEntries(map) {
	return [...map].sort(([left], [right]) => left.localeCompare(right));
}

function collectPrimitiveValueListLengths(value, lengths, seen = new Set()) {
	if (value === null || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	if (value.kind === "PrimitiveValueListNode") lengths.push(value.values.length);
	for (const child of Object.values(value)) {
		if (Array.isArray(child)) {
			for (const item of child) collectPrimitiveValueListLengths(item, lengths, seen);
		} else {
			collectPrimitiveValueListLengths(child, lengths, seen);
		}
	}
}

test("returns only ready rows with a non-empty content hash", async (t) => {
	const directory = await makeTestDirectory(t);
	const database = await makeMediaDatabase(t, directory, [
		{ id: "ready-hash", storage_key: "ready-hash.png", content_hash: `sha1:${"1".repeat(40)}` },
		{ id: "uploading-hash", storage_key: "uploading.png", status: "uploading", content_hash: `sha1:${"2".repeat(40)}` },
		{ id: "null-hash", storage_key: "null.png", content_hash: null },
		{ id: "empty-hash", storage_key: "empty.png", content_hash: "" },
		{ id: "whitespace-hash", storage_key: "whitespace.png", content_hash: "  " },
	]);

	const hashes = await loadContentHashes({ db: database }, [
		"ready-hash",
		"uploading-hash",
		"null-hash",
		"empty-hash",
		"whitespace-hash",
		"unknown-id",
	]);

	assert.deepEqual(sortedEntries(hashes), [["ready-hash", `sha1:${"1".repeat(40)}`]]);
});

test("deduplicates and filters ids, accepts a Set, and is exported from the package root", async (t) => {
	const directory = await makeTestDirectory(t);
	const database = await makeMediaDatabase(t, directory, [
		{ id: "first", storage_key: "first.png", content_hash: `sha1:${"a".repeat(40)}` },
		{ id: "second", storage_key: "second.png", content_hash: `sha1:${"b".repeat(40)}` },
	]);
	const ids = [undefined, "first", null, "", "first", 42, "second"];
	const arrayResult = await loadContentHashes({ db: database }, ids);
	const setResult = await loadContentHashes({ db: database }, new Set(ids));
	const packageRoot = await import("@nimitzua/emdash-images");

	assert.deepEqual(sortedEntries(arrayResult), [
		["first", `sha1:${"a".repeat(40)}`],
		["second", `sha1:${"b".repeat(40)}`],
	]);
	assert.deepEqual(sortedEntries(setResult), sortedEntries(arrayResult));
	assert.equal(packageRoot.loadContentHashes, loadContentHashes);
});

test("queries 1,201 distinct ids in three batches of at most 500", async (t) => {
	const directory = await makeTestDirectory(t);
	const readyHashes = new Map([
		["media-0000", `sha1:${"0".repeat(40)}`],
		["media-0500", `sha1:${"5".repeat(40)}`],
		["media-1200", `sha1:${"c".repeat(40)}`],
	]);
	const database = await makeMediaDatabase(t, directory, [
		...Array.from(readyHashes, ([id, content_hash]) => ({ id, storage_key: `${id}.png`, content_hash })),
		{ id: "media-0900", storage_key: "uploading.png", status: "uploading", content_hash: `sha1:${"9".repeat(40)}` },
	]);
	let queryCount = 0;
	const valueListLengths = [];
	const countedDatabase = database.withPlugin({
		transformQuery({ node }) {
			queryCount += 1;
			collectPrimitiveValueListLengths(node, valueListLengths);
			return node;
		},
		transformResult({ result }) {
			return result;
		},
	});
	const ids = Array.from({ length: 1201 }, (_, index) => `media-${String(index).padStart(4, "0")}`);

	const hashes = await loadContentHashes({ db: countedDatabase }, ids);

	assert.equal(queryCount, 3);
	assert.deepEqual(valueListLengths, [500, 500, 201]);
	assert.deepEqual(sortedEntries(hashes), [...readyHashes].sort(([left], [right]) => left.localeCompare(right)));
});

test("empty ids return without reading the database", async () => {
	const emdash = {
		get db() {
			throw new Error("database was accessed");
		},
	};

	assert.deepEqual(await loadContentHashes(emdash, []), new Map());
	assert.deepEqual(await loadContentHashes(emdash, null), new Map());
	assert.deepEqual(await loadContentHashes(emdash, undefined), new Map());
});

test("returns an empty map when no media database is configured", async () => {
	assert.deepEqual(await loadContentHashes({}, ["id"]), new Map());
});

test("propagates a query error when the database has no media table", async (t) => {
	const directory = await makeTestDirectory(t);
	const { createDialect } = await import("emdash/db/sqlite");
	const database = new Kysely({ dialect: createDialect({ url: path.join(directory, "no-media.db") }) });
	t.after(() => database.destroy());

	await assert.rejects(loadContentHashes({ db: database }, ["id"]), /no such table: media/i);
});

test("compiles PostgreSQL batches with positional parameters", async (t) => {
	const compiledQueries = [];
	const driver = {
		async init() {},
		async acquireConnection() {
			return {
				async executeQuery(query) {
					compiledQueries.push(query);
					return { rows: [] };
				},
				async *streamQuery() {},
			};
		},
		async beginTransaction() {},
		async commitTransaction() {},
		async rollbackTransaction() {},
		async releaseConnection() {},
		async destroy() {},
	};
	const database = new Kysely({
		dialect: {
			createAdapter: () => new PostgresAdapter(),
			createDriver: () => driver,
			createQueryCompiler: () => new PostgresQueryCompiler(),
			createIntrospector: (db) => new PostgresIntrospector(db),
		},
	});
	t.after(() => database.destroy());

	await loadContentHashes({ db: database }, ["first", "second"]);

	assert.equal(compiledQueries.length, 1);
	assert.match(compiledQueries[0].sql, /\bin\s*\(\$1,\s*\$2\)/i);
	assert.doesNotMatch(compiledQueries[0].sql, /\?/);
	assert.deepEqual(
		[...compiledQueries[0].sql.matchAll(/\$(\d+)/g)].map(([, number]) => Number(number)),
		compiledQueries[0].parameters.map((_, index) => index + 1),
	);
});
