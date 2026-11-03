import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { computeContentHash } from "emdash";
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { imageCacheSettings8, imageVariantCachePath } from "@nimitzua/emdash-images/layout";
import { backfillMediaRows, cleanupImageCache } from "@nimitzua/emdash-images/maintenance";
import { hashStoredMediaFile, parseArguments } from "../src/backfill.mjs";
import { assertPathInsideCache, validateCacheDirectory } from "../src/cleanup.mjs";
import { createMediaDatabase } from "./sqlite-media.mjs";

function imageRow(id, storageKey, extra = {}) {
	return {
		id,
		storage_key: storageKey,
		size: 1,
		mime_type: "image/png",
		status: "ready",
		content_hash: null,
		width: null,
		height: null,
		blurhash: null,
		dominant_color: null,
		...extra,
	};
}

async function writeVariant(cacheDirectory, mediaId, hash16, contents, config) {
	const target = imageVariantCachePath(cacheDirectory, mediaId, hash16, 640, "webp", config);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, contents);
	return target;
}

async function createCleanupDatabase(directory, rows = []) {
	return createMediaDatabase(directory, rows);
}

async function createBackfillDatabase(directory, rows = []) {
	await mkdir(directory, { recursive: true });
	return createMediaDatabase(directory, rows);
}

async function readMediaRows(database) {
	return database.selectFrom("media").selectAll().orderBy("id").execute();
}

async function createRecordingPostgresDatabase({ rows = [] } = {}) {
	const compiledQueries = [];
	const driver = {
		async init() {},
		async acquireConnection() {
			return {
				async executeQuery(query) {
					compiledQueries.push(query);
					if (/^select/i.test(query.sql)) return { rows };
					return { numAffectedRows: 1n };
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
	return { database, compiledQueries };
}

test("backfill applies denied prefixes before listing candidates while preserving hash candidates", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-backfill-prefixes-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const { default: sharp } = await import("sharp");
	const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: { r: 211, g: 74, b: 91 } } }).png().toBuffer();
	const storageKeys = [
		"work/public.png",
		"private-cases/case.png",
		"Private-Cases/upper-case.png",
	];
	for (const key of storageKeys) {
		const file = path.join(directory, key);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, bytes);
	}
	const rows = [
		imageRow("public", "work/public.png"),
		imageRow("private-path", "private-cases/case.png"),
		imageRow("private-case-variant", "Private-Cases/upper-case.png"),
		imageRow("private-bare-key", "private-cases", {
			content_hash: await computeContentHash(bytes),
		}),
		imageRow("private-empty-segment", "private-cases//a.png"),
		imageRow("private-trailing-slash", "private-cases/"),
		imageRow("private-dot-segment", "Private-Cases/./x.png"),
		imageRow("private-dotdot-segment", "private-cases/../x.png"),
	];
	const { database } = await createCleanupDatabase(directory, rows);
	t.after(() => database.destroy());
	const output = [];
	const result = await backfillMediaRows({
		args: [],
		env: { UPLOADS_DIR: directory },
		database,
		deniedStorageKeyPrefixes: ["private-cases/"],
		log: (line) => output.push(String(line)),
		errorLog: () => undefined,
	});

	assert.deepEqual(result.wouldFillByField, {
		content_hash: 3,
		width: 1,
		height: 1,
		blurhash: 1,
		dominant_color: 1,
	});
	assert.equal(result.found, 7);
	assert.equal(result.missing, 4);
	assert.equal(result.failed, 4);
	assert.deepEqual(
		output.filter((line) => line.startsWith("id=")).map((line) => line.match(/^id="([^"]+)"/)?.[1]),
		[
			"private-case-variant",
			"private-dot-segment",
			"private-dotdot-segment",
			"private-empty-segment",
			"private-path",
			"private-trailing-slash",
			"public",
		],
	);
	assert.ok(output.some((line) => line.includes('id="private-path"') && line.includes("missing_fields=content_hash")));
	assert.ok(output.some((line) => line.includes('id="private-case-variant"') && line.includes("missing_fields=content_hash")));
	for (const id of ["private-empty-segment", "private-trailing-slash", "private-dot-segment", "private-dotdot-segment"]) {
		const line = output.find((entry) => entry.startsWith(`id=${JSON.stringify(id)} `));
		assert.match(line, /missing_fields=content_hash(?: missing-file)?$/);
	}
	assert.ok(output.includes("Rows needing backfill: 7"));
	assert.ok(output.includes("Rows missing content_hash: 7"));
	assert.ok(output.includes("Rows missing width: 1"));
	assert.ok(output.includes("Rows missing height: 1"));
	assert.ok(output.includes("Rows missing blurhash: 1"));
	assert.ok(output.includes("Rows missing dominant_color: 1"));
	assert.ok(output.includes("Files available: 3"));
	assert.ok(output.includes("Missing files: 4"));
	assert.ok(!output.some((line) => line.includes('id="private-bare-key"')));
});

test("backfill queries compile for PostgreSQL without dialect-specific SQL", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-backfill-postgres-compile-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const uploadsDirectory = path.join(directory, "uploads");
	await mkdir(path.join(uploadsDirectory, "work"), { recursive: true });
	const bytes = Buffer.from("postgres recording driver backfill candidate");
	await writeFile(path.join(uploadsDirectory, "work/file.bin"), bytes);
	const row = imageRow("postgres-recording", "work/file.bin", {
		mime_type: "application/octet-stream",
		size: bytes.length,
		width: 1,
		height: 1,
		blurhash: "stored",
		dominant_color: "#000000",
	});
	const { database, compiledQueries } = await createRecordingPostgresDatabase({ rows: [row] });
	try {
		await backfillMediaRows({
			args: [],
			env: { UPLOADS_DIR: uploadsDirectory },
			database,
			log: () => undefined,
			errorLog: () => undefined,
		});
		assert.equal(compiledQueries.length, 1);
		await backfillMediaRows({
			args: ["--write"],
			env: { UPLOADS_DIR: uploadsDirectory },
			database,
			log: () => undefined,
			errorLog: () => undefined,
		});
		assert.equal(compiledQueries.length, 3);
		for (const query of compiledQueries) {
			assert.doesNotMatch(query.sql, /unnest|::|char_length|left\(/i);
			assert.doesNotMatch(query.sql, /\?/);
			assert.equal([...query.sql.matchAll(/\$\d+/g)].length, query.parameters.length);
		}
	} finally {
		await database.destroy();
	}
});

test("backfill skips a selected row when its storage key changes before write", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-backfill-changed-row-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const uploadsDirectory = path.join(directory, "uploads");
	await mkdir(path.join(uploadsDirectory, "work"), { recursive: true });
	const bytes = Buffer.from("selected before its storage key changes");
	await writeFile(path.join(uploadsDirectory, "work/photo.png"), bytes);
	const row = imageRow("changed-storage-key", "work/photo.png", {
		size: bytes.length,
		width: 2,
		height: 1,
		blurhash: "stored",
		dominant_color: "#000000",
	});
	const { database, databasePath } = await createBackfillDatabase(directory, [row]);
	t.after(() => database.destroy());
	const { DatabaseSync } = await import("node:sqlite");
	const secondConnection = new DatabaseSync(databasePath);
	t.after(() => secondConnection.close());
	const output = [];
	const result = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: uploadsDirectory },
		database,
		log: (line) => {
			output.push(String(line));
			if (line === "Rows needing backfill: 1") {
				secondConnection.prepare("UPDATE media SET storage_key = ? WHERE id = ?").run("work/changed.png", row.id);
			}
		},
		errorLog: () => undefined,
	});
	assert.equal(result.filled, 0);
	assert.equal(result.skipped, 1);
	assert.ok(output.includes("Skipped because rows changed: 1"));
	const persisted = await readMediaRows(database);
	assert.equal(persisted[0].storage_key, "work/changed.png");
	assert.equal(persisted[0].content_hash, null);
});

test("backfill opens and closes a file URL database", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-backfill-file-url-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const uploadsDirectory = path.join(directory, "uploads");
	await mkdir(path.join(uploadsDirectory, "work"), { recursive: true });
	const { default: sharp } = await import("sharp");
	const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: { r: 211, g: 74, b: 91 } } }).png().toBuffer();
	await writeFile(path.join(uploadsDirectory, "work/photo.png"), bytes);
	const { database, databasePath } = await createBackfillDatabase(directory, [
		imageRow("file-url-row", "work/photo.png", { size: bytes.length }),
	]);
	await database.destroy();
	const result = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: uploadsDirectory, DATABASE_URL: `file:${databasePath}` },
		log: () => undefined,
		errorLog: () => undefined,
	});
	assert.equal(result.filled, 5);
	await assert.rejects(lstat(`${databasePath}-wal`), { code: "ENOENT" });
	const { createDialect } = await import("emdash/db/sqlite");
	const reopenedDatabase = new Kysely({ dialect: createDialect({ url: databasePath }) });
	try {
		const [persisted] = await readMediaRows(reopenedDatabase);
		assert.equal(persisted.content_hash, await computeContentHash(bytes));
		assert.equal(persisted.width, 2);
		assert.equal(persisted.height, 1);
		assert.ok(persisted.blurhash);
		assert.ok(persisted.dominant_color);
	} finally {
		await reopenedDatabase.destroy();
	}
});

test("cleanup opens and closes a file URL database", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cleanup-file-url-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const cacheDirectory = path.join(directory, "cache");
	await mkdir(cacheDirectory);
	const { database, databasePath } = await createCleanupDatabase(directory);
	await database.destroy();
	await cleanupImageCache({
		env: { IMAGE_CACHE_DIR: cacheDirectory, DATABASE_URL: `file:${databasePath}` },
		log: () => undefined,
	});
	await assert.rejects(lstat(`${databasePath}-wal`), { code: "ENOENT" });
});

test("backfill refuses the removed pool option", async () => {
	await assert.rejects(
		backfillMediaRows({ args: [], pool: {} }),
		(error) => error instanceof TypeError && /database/.test(error.message),
	);
});

test("backfill hashes stored files and rejects paths outside uploads", async (t) => {
	const uploadsDirectory = await mkdtemp(path.join(tmpdir(), "media-hash-backfill-"));
	t.after(() => rm(uploadsDirectory, { recursive: true, force: true }));
	const bytes = Buffer.from("EmDash media hash test bytes\0with binary content", "utf8");
	await mkdir(path.join(uploadsDirectory, "work"));
	await writeFile(path.join(uploadsDirectory, "work/photo.png"), bytes);
	assert.equal(await hashStoredMediaFile(uploadsDirectory, "work/photo.png"), await computeContentHash(bytes));
	await assert.rejects(hashStoredMediaFile(uploadsDirectory, "../outside.png"), /invalid|escapes/i);
});

test("backfill counts directory storage keys as failed rows", async (t) => {
	const uploadsDirectory = await mkdtemp(path.join(tmpdir(), "media-hash-directory-backfill-"));
	t.after(() => rm(uploadsDirectory, { recursive: true, force: true }));
	await mkdir(path.join(uploadsDirectory, "work", "folder"), { recursive: true });
	const row = imageRow("directory-storage-key", "work/folder");
	const { database } = await createCleanupDatabase(uploadsDirectory, [row]);
	t.after(() => database.destroy());
	const errors = [];
	const result = await backfillMediaRows({
		args: [],
		env: { UPLOADS_DIR: uploadsDirectory },
		database,
		log: () => undefined,
		errorLog: (line) => errors.push(String(line)),
	});

	assert.equal(result.found, 1);
	assert.equal(result.missing, 1);
	assert.equal(result.failed, 1);
	assert.equal(result.exitCode, 3);
	assert.equal(result.wouldFill, 0);
	assert.equal((await readMediaRows(database))[0].content_hash, null);
	assert.match(errors[0], /directory-storage-key.*original file is not a regular file/);
});

test("backfill accepts only its documented write flag", () => {
	assert.deepEqual(parseArguments([]), { write: false });
	assert.deepEqual(parseArguments(["--write"]), { write: true });
	assert.throws(() => parseArguments(["--container-local"]), /Usage/);
});

test("backfill fills empty fields once, keeps dry runs read-only, and isolates failed rows", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-backfill-rows-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const { default: sharp } = await import("sharp");
	const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: { r: 211, g: 74, b: 91 } } }).png().toBuffer();
	await mkdir(path.join(directory, "work"));
	await writeFile(path.join(directory, "work/photo.png"), bytes);
	const freshRow = () => imageRow("media-backfill-image", "work/photo.png", { size: bytes.length });
	const output = [];
	const { database: writeDatabase } = await createBackfillDatabase(path.join(directory, "write"), [freshRow()]);
	t.after(() => writeDatabase.destroy());
	const writeResult = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: directory },
		database: writeDatabase,
		log: (line) => output.push(String(line)),
		errorLog: () => undefined,
	});
	const writtenRows = await readMediaRows(writeDatabase);
	assert.equal(writtenRows[0].content_hash, await computeContentHash(bytes));
	assert.equal(writtenRows[0].width, 2);
	assert.equal(writtenRows[0].height, 1);
	assert.ok(writtenRows[0].blurhash);
	assert.ok(writtenRows[0].dominant_color);
	assert.equal(writeResult.exitCode, 0);
	assert.deepEqual(writeResult.filledByField, {
		content_hash: 1,
		width: 1,
		height: 1,
		blurhash: 1,
		dominant_color: 1,
	});
	assert.ok(output.includes("Changes written: 5"));

	const secondWrite = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: directory },
		database: writeDatabase,
		log: (line) => output.push(String(line)),
		errorLog: () => undefined,
	});
	assert.equal(secondWrite.found, 0);
	assert.deepEqual(secondWrite.filledByField, {
		content_hash: 0,
		width: 0,
		height: 0,
		blurhash: 0,
		dominant_color: 0,
	});

	const dryRow = freshRow();
	const unchangedDryRow = structuredClone(dryRow);
	const { database: dryDatabase } = await createBackfillDatabase(path.join(directory, "dry"), [dryRow]);
	t.after(() => dryDatabase.destroy());
	const dryResult = await backfillMediaRows({
		args: [],
		env: { UPLOADS_DIR: directory },
		database: dryDatabase,
		log: (line) => output.push(String(line)),
		errorLog: () => undefined,
	});
	const dryRows = await readMediaRows(dryDatabase);
	for (const field of ["id", "storage_key", "mime_type", "size", "status", "content_hash", "width", "height", "blurhash", "dominant_color"]) {
		assert.equal(dryRows[0][field], unchangedDryRow[field]);
	}
	assert.deepEqual(dryResult.wouldFillByField, {
		content_hash: 1,
		width: 1,
		height: 1,
		blurhash: 1,
		dominant_color: 1,
	});
	for (const field of ["content_hash", "width", "height", "blurhash", "dominant_color"]) {
		assert.ok(output.some((line) => line.includes(`Would fill ${field}: 1`)), `dry-run report counts ${field}`);
		assert.ok(output.some((line) => line.includes(`Filled ${field}: 1`)), `write report counts ${field}`);
	}
	assert.equal(output.filter((line) => line === "Changes written: 0").length, 2);

	const partialRow = {
		...freshRow(),
		id: "partial-row-with-one-dimension",
		width: 640,
		height: null,
	};
	const partialOutput = [];
	const { database: partialDatabase } = await createBackfillDatabase(path.join(directory, "partial"), [partialRow]);
	t.after(() => partialDatabase.destroy());
	const partialResult = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: directory },
		database: partialDatabase,
		log: (line) => partialOutput.push(String(line)),
		errorLog: () => undefined,
	});
	const partialRows = await readMediaRows(partialDatabase);
	assert.equal(partialRows[0].content_hash, await computeContentHash(bytes));
	assert.equal(partialRows[0].width, 640);
	assert.equal(partialRows[0].height, null);
	assert.ok(partialRows[0].blurhash);
	assert.ok(partialRows[0].dominant_color);
	assert.equal(partialResult.filledByField.width, 0);
	assert.equal(partialResult.filledByField.height, 0);
	assert.ok(partialOutput.some((line) => line.includes("skipped: one dimension stored") && line.includes(partialRow.id)));

	const corruptBytes = Buffer.from("not a decodable image");
	await writeFile(path.join(directory, "work/corrupt.png"), corruptBytes);
	const badRows = [
		freshRow(),
		{ ...freshRow(), id: "corrupt-image-row", storage_key: "work/corrupt.png", size: corruptBytes.length },
		{ ...freshRow(), id: "missing-image-row", storage_key: "work/missing.png" },
	];
	const { database: badRowsDatabase } = await createBackfillDatabase(path.join(directory, "bad-rows"), badRows);
	t.after(() => badRowsDatabase.destroy());
	const failedOutput = [];
	const errors = [];
	const failedResult = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: directory },
		database: badRowsDatabase,
		log: (line) => failedOutput.push(String(line)),
		errorLog: (line) => errors.push(String(line)),
	});
	assert.equal(failedResult.exitCode, 3);
	assert.equal(failedResult.failed, 2);
	assert.ok(failedOutput.includes("Failed rows: 2"));
	assert.ok(errors.some((line) => line.includes("corrupt-image-row") && line.includes("work/corrupt.png")));
	assert.ok(errors.some((line) => line.includes("missing-image-row") && line.includes("work/missing.png")));
	const persistedBadRows = await readMediaRows(badRowsDatabase);
	const goodRow = persistedBadRows.find((row) => row.id === "media-backfill-image");
	assert.equal(goodRow.content_hash, await computeContentHash(bytes));
	assert.equal(goodRow.width, 2);
	assert.equal(goodRow.height, 1);
	assert.ok(goodRow.blurhash);
	assert.ok(goodRow.dominant_color);
	for (const rowId of ["corrupt-image-row", "missing-image-row"]) {
		const row = persistedBadRows.find((candidate) => candidate.id === rowId);
		assert.equal(row.content_hash, null, `${rowId} remains unmodified`);
		assert.equal(row.width, null, `${rowId} dimensions remain unmodified`);
	}
	await assert.rejects(backfillMediaRows({ args: ["--invalid"], database: writeDatabase }), /Usage/);
});

test("cleanup rejects unset, root, symlink, and escaping cache paths", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cache-guard-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const realCache = path.join(directory, "cache");
	const linkedCache = path.join(directory, "cache-link");
	await mkdir(realCache);
	await symlink(realCache, linkedCache, "dir");
	const { database } = await createCleanupDatabase(directory);
	t.after(() => database.destroy());

	await assert.rejects(validateCacheDirectory(undefined), /IMAGE_CACHE_DIR must be set/);
	await assert.rejects(validateCacheDirectory("/"), /must not be the filesystem root/);
	await assert.rejects(validateCacheDirectory(linkedCache), /must not be a symbolic link/);
	await assert.rejects(
		cleanupImageCache({ env: { IMAGE_CACHE_DIR: linkedCache }, database }),
		/must not be a symbolic link/,
	);
	assert.throws(() => assertPathInsideCache(realCache, path.join(directory, "outside.txt")), /escapes IMAGE_CACHE_DIR/);
	assert.equal(await validateCacheDirectory(realCache), await realpath(realCache));
});

test("cleanup dry-run lists stale categories and delete is safe and idempotent", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cache-cleanup-"));
	const cacheDirectory = path.join(directory, "cache");
	const outsideDirectory = path.join(directory, "outside");
	await Promise.all([mkdir(cacheDirectory), mkdir(outsideDirectory)]);
	t.after(() => rm(directory, { recursive: true, force: true }));

	const config = { service: { config: { avif: { quality: 55, effort: 4, chromaSubsampling: "4:4:4" }, webp: { quality: 75, effort: 4, smartSubsample: true } } } };
	const currentHash = "a".repeat(16);
	const fullHash = (value) => `sha1:${value.repeat(40)}`;
	const rows = [
		{ id: "keep-ready", status: "ready", storage_key: "work/current.png", content_hash: fullHash("a") },
		{ id: "not-ready", status: "uploading", storage_key: "work/upload.png", content_hash: fullHash("a") },
		{ id: "private-media", status: "ready", storage_key: "private-cases/case/image.png", content_hash: fullHash("a") },
		{ id: "changed-media", status: "ready", storage_key: "work/changed.png", content_hash: fullHash("b") },
		{ id: "no-hash", status: "ready", storage_key: "work/legacy.png", content_hash: null },
		{ id: "no-hash-empty", status: "ready", storage_key: "work/legacy-empty.png", content_hash: "" },
	];
	const keepReady = await writeVariant(cacheDirectory, "keep-ready", currentHash, "keep current", config);
	const missingRow = await writeVariant(cacheDirectory, "missing-row", currentHash, "missing row", config);
	const notReady = await writeVariant(cacheDirectory, "not-ready", currentHash, "not ready", config);
	const privateMedia = await writeVariant(cacheDirectory, "private-media", currentHash, "private", config);
	const changedMedia = await writeVariant(cacheDirectory, "changed-media", currentHash, "stale hash", config);
	const noHash = await writeVariant(cacheDirectory, "no-hash", currentHash, "no hash", config);
	const noHashEmpty = await writeVariant(cacheDirectory, "no-hash-empty", currentHash, "empty", config);

	const settings8 = imageCacheSettings8(config);
	const oldNamespace = path.join(cacheDirectory, `v2-${settings8 === "deadbeef" ? "01234567" : "deadbeef"}`, "old-media", `${currentHash}-640.webp`);
	await mkdir(path.dirname(oldNamespace), { recursive: true });
	await writeFile(oldNamespace, "old encoder");
	const flatLayout = path.join(cacheDirectory, "cc", `${"c".repeat(64)}.avif`);
	await mkdir(path.dirname(flatLayout), { recursive: true });
	await writeFile(flatLayout, "old flat");
	const oldTemporary = path.join(cacheDirectory, "v2-old", ".stale-write.tmp");
	const recentTemporary = path.join(cacheDirectory, "v2-old", ".recent-write.tmp");
	await mkdir(path.dirname(oldTemporary), { recursive: true });
	await writeFile(oldTemporary, "old temp");
	await writeFile(recentTemporary, "recent temp");
	const preexistingEmptyDirectories = [
		path.join(cacheDirectory, "v2-empty", "empty-media"),
		path.join(cacheDirectory, "aa"),
	];
	await Promise.all(preexistingEmptyDirectories.map((emptyDirectory) => mkdir(emptyDirectory, { recursive: true })));
	const now = Date.now();
	await utimes(oldTemporary, new Date(now - 3_700_000), new Date(now - 3_700_000));
	await utimes(recentTemporary, new Date(now - 10_000), new Date(now - 10_000));

	const outsideFile = path.join(outsideDirectory, `${"d".repeat(64)}.webp`);
	await writeFile(outsideFile, "do not touch");
	await symlink(outsideDirectory, path.join(cacheDirectory, "v2-outside"), "dir");
	const output = [];
	const { database } = await createCleanupDatabase(directory, rows);
	t.after(() => database.destroy());
	const env = { IMAGE_CACHE_DIR: cacheDirectory };
	const options = {
		args: [],
		env,
		database,
		now,
		deniedStorageKeyPrefixes: ["private-cases/"],
		encoder: config.service.config,
	};

	const dryRun = await cleanupImageCache({ ...options, log: (line) => output.push(String(line)) });
	assert.equal(dryRun.mode, "dry run");
	assert.equal(dryRun.deletedFiles, 0);
	assert.deepEqual(
		dryRun.candidates.map(({ category, relativePath }) => `${category}:${relativePath}`).sort(),
		[
			`missing-media-row:${path.relative(cacheDirectory, missingRow)}`,
			`not-ready:${path.relative(cacheDirectory, notReady)}`,
			`private-storage-key:${path.relative(cacheDirectory, privateMedia)}`,
			`hash-mismatch:${path.relative(cacheDirectory, changedMedia)}`,
			`old-v2-namespace:${path.relative(cacheDirectory, oldNamespace)}`,
			`legacy-flat-layout:${path.relative(cacheDirectory, flatLayout)}`,
			`stale-temp-file:${path.relative(cacheDirectory, oldTemporary)}`,
		].sort(),
	);
	assert.deepEqual(
		{
			count: dryRun.categories["kept-no-content-hash"].count,
			bytes: dryRun.categories["kept-no-content-hash"].bytes,
		},
		{ count: 2, bytes: 12 },
	);
	assert.deepEqual(
		dryRun.categories["kept-no-content-hash"].files.map(({ relativePath }) => relativePath).sort(),
		[path.relative(cacheDirectory, noHash), path.relative(cacheDirectory, noHashEmpty)].sort(),
	);
	assert.ok(output.includes("kept-no-content-hash: 2 files, 12 bytes"));
	assert.deepEqual(output.filter((line) => line.startsWith("Total cache size")), [
		`Total cache size before: ${dryRun.totalBytesBefore} bytes`,
		`Total cache size after: ${dryRun.totalBytesAfter} bytes`,
	]);
	assert.deepEqual(await readFile(outsideFile, "utf8"), "do not touch");
	assert.deepEqual(await readFile(keepReady, "utf8"), "keep current");
	assert.deepEqual(await readFile(noHash, "utf8"), "no hash");
	assert.deepEqual(await readFile(noHashEmpty, "utf8"), "empty");
	assert.deepEqual(await readFile(recentTemporary, "utf8"), "recent temp");

	const deletion = await cleanupImageCache({ ...options, args: ["--delete"], log: () => undefined });
	assert.equal(deletion.deletedFiles, 7);
	assert.equal(deletion.candidateCountAfter, 0);
	assert.deepEqual(await readFile(outsideFile, "utf8"), "do not touch");
	assert.deepEqual(await readFile(keepReady, "utf8"), "keep current");
	assert.deepEqual(await readFile(noHash, "utf8"), "no hash");
	assert.deepEqual(await readFile(noHashEmpty, "utf8"), "empty");
	assert.deepEqual(await readFile(recentTemporary, "utf8"), "recent temp");
	for (const emptyDirectory of [
		path.dirname(missingRow),
		path.dirname(notReady),
		path.dirname(privateMedia),
		path.dirname(changedMedia),
		path.dirname(oldNamespace),
		path.dirname(path.dirname(oldNamespace)),
		path.dirname(flatLayout),
	]) {
		await assert.rejects(lstat(emptyDirectory), { code: "ENOENT" }, emptyDirectory);
	}
	for (const emptyDirectory of preexistingEmptyDirectories) {
		await assert.rejects(lstat(emptyDirectory), { code: "ENOENT" }, emptyDirectory);
	}
	assert.equal((await lstat(cacheDirectory)).isDirectory(), true, "the cache root should remain");

	const rerun = await cleanupImageCache({ ...options, args: ["--delete"], log: () => undefined });
	assert.equal(rerun.candidateCountBefore, 0);
	assert.equal(rerun.deletedFiles, 0);
});

test("cleanup leaves a variant created after its cache listing", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cache-list-race-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const cacheDirectory = path.join(directory, "cache");
	await mkdir(cacheDirectory);
	const config = { service: { config: { avif: { quality: 55, effort: 4, chromaSubsampling: "4:4:4" }, webp: { quality: 75, effort: 4, smartSubsample: true } } } };
	const currentHash = "a".repeat(16);
	const row = { id: "published-during-list", status: "ready", storage_key: "work/new.png", content_hash: `sha1:${"a".repeat(40)}` };
	let listed = false;
	let variantPath;
	const { database } = await createCleanupDatabase(directory, [row]);
	t.after(() => database.destroy());
	const listCacheFiles = async (listedDirectory) => {
		const files = [];
		if (variantPath) {
			try {
				const info = await lstat(variantPath);
				if (info.isFile()) files.push({ path: variantPath, relativePath: path.relative(listedDirectory, variantPath), size: info.size, mtimeMs: info.mtimeMs });
			} catch (error) {
				if (error?.code !== "ENOENT") throw error;
			}
		}
		listed = true;
		return files;
	};
	const listingRaceDatabase = database.withPlugin({
		transformQuery({ node }) {
			return node;
		},
		async transformResult({ result }) {
			if (listed && !variantPath) {
				variantPath = imageVariantCachePath(cacheDirectory, row.id, currentHash, 640, "webp", config);
				await mkdir(path.dirname(variantPath), { recursive: true });
				await writeFile(variantPath, "new publish");
			}
			return result;
		},
	});
	const result = await cleanupImageCache({
		args: ["--delete"],
		env: { IMAGE_CACHE_DIR: cacheDirectory },
		database: listingRaceDatabase,
		encoder: config.service.config,
		listCacheFiles,
		log: () => undefined,
	});
	assert.equal(result.deletedFiles, 0);
	assert.equal(await readFile(variantPath, "utf8"), "new publish");
});

test("cleanup opens a file: database URL and returns the expected dry-run candidates", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cache-file-url-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const cacheDirectory = path.join(directory, "cache");
	await mkdir(cacheDirectory);
	const config = { service: { config: { avif: { quality: 55, effort: 4, chromaSubsampling: "4:4:4" }, webp: { quality: 75, effort: 4, smartSubsample: true } } } };
	const currentHash = "a".repeat(16);
	const row = { id: "not-ready-from-file-url", status: "uploading", storage_key: "work/upload.png", content_hash: `sha1:${"a".repeat(40)}` };
	const candidatePath = await writeVariant(cacheDirectory, row.id, currentHash, "not ready", config);
	const { database, databasePath } = await createCleanupDatabase(directory, [row]);
	await database.destroy();

	const result = await cleanupImageCache({
		args: [],
		env: { IMAGE_CACHE_DIR: cacheDirectory, DATABASE_URL: `file:${databasePath}` },
		encoder: config.service.config,
		log: () => undefined,
	});
	assert.deepEqual(result.candidates.map(({ category, relativePath }) => ({ category, relativePath })), [
		{ category: "not-ready", relativePath: path.relative(cacheDirectory, candidatePath) },
	]);
});

test("cleanup keeps a supplied database usable after the call", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cache-supplied-database-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const cacheDirectory = path.join(directory, "cache");
	await mkdir(cacheDirectory);
	const { database } = await createCleanupDatabase(directory, [
		{ id: "still-open", status: "ready", storage_key: "work/current.png", content_hash: null },
	]);
	t.after(() => database.destroy());

	await cleanupImageCache({
		args: [],
		env: { IMAGE_CACHE_DIR: cacheDirectory },
		database,
		log: () => undefined,
	});
	const rows = await database.selectFrom("media").select("id").execute();
	assert.deepEqual(rows.map(({ id }) => id), ["still-open"]);
});

test("cleanup refuses the removed pool option", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cache-pool-refused-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const cacheDirectory = path.join(directory, "cache");
	await mkdir(cacheDirectory);
	await assert.rejects(
		cleanupImageCache({ env: { IMAGE_CACHE_DIR: cacheDirectory }, pool: {} }),
		(error) => error instanceof TypeError && /database/.test(error.message),
	);
});

test("cleanup query compiles for PostgreSQL without dialect-specific SQL", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cache-postgres-compile-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const cacheDirectory = path.join(directory, "cache");
	await mkdir(cacheDirectory);
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
	try {
		await cleanupImageCache({
			args: [],
			env: { IMAGE_CACHE_DIR: cacheDirectory },
			database,
			listCacheFiles: async () => [],
			log: () => undefined,
		});
		assert.equal(compiledQueries.length, 1);
		assert.doesNotMatch(compiledQueries[0].sql, /unnest|::|char_length/i);
	} finally {
		await database.destroy();
	}
});
