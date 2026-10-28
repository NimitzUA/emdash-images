import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { computeContentHash } from "emdash";
import { imageCacheSettings8, imageVariantCachePath } from "@nimitzua/emdash-images/layout";
import { backfillMediaRows, cleanupImageCache } from "@nimitzua/emdash-images/maintenance";
import { hashStoredMediaFile, parseArguments } from "../src/backfill.mjs";
import { assertPathInsideCache, validateCacheDirectory } from "../src/cleanup.mjs";

function deniedStorageKey(key, prefixes) {
	const normalizedKey = key.toLowerCase();
	return prefixes.some((prefix) => {
		const normalizedPrefix = prefix.replace(/\/+$/, "").toLowerCase();
		return normalizedKey === normalizedPrefix || normalizedKey.startsWith(`${normalizedPrefix}/`);
	});
}

function createBackfillPool(rows) {
	const queries = [];
	return {
		rows,
		queries,
		async query(sql, values = []) {
			queries.push({ sql, values });
			if (sql.startsWith("SELECT")) {
				const [deniedPrefixes = []] = values;
				return { rows: rows.filter((row) => row.status === "ready" && (
					row.content_hash == null || row.content_hash === "" || (
						row.mime_type?.toLowerCase().startsWith("image/") &&
						!deniedStorageKey(row.storage_key, deniedPrefixes) && (
							row.width == null || row.height == null || row.blurhash == null || row.blurhash === "" ||
							row.dominant_color == null || row.dominant_color === ""
						)
					)
				)) };
			}
			const field = /UPDATE media SET ([a-z_]+) = \$1/.exec(sql)?.[1];
			assert.ok(field, `unexpected backfill update: ${sql}`);
			const [value, id, storageKey] = values;
			const row = rows.find((candidate) => candidate.id === id && candidate.storage_key === storageKey && candidate.status === "ready");
			if (!row) return { rowCount: 0 };
			const missing = field === "width" || field === "height"
				? row[field] == null
				: row[field] == null || row[field] === "";
			if (!missing) return { rowCount: 0 };
			row[field] = value;
			return { rowCount: 1 };
		},
	};
}

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

test("backfill uses denied prefixes for SQL selection and metadata while preserving hash candidates", async (t) => {
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
	const pool = createBackfillPool(rows);
	const output = [];
	const result = await backfillMediaRows({
		args: [],
		env: { UPLOADS_DIR: directory },
		pool,
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
	assert.match(pool.queries[0].sql, /unnest\(\$2::text\[\]\)/);
	assert.doesNotMatch(pool.queries[0].sql, /private-cases/i);
	assert.deepEqual(pool.queries[0].values, [["private-cases"], ["private-cases/"]]);
	assert.deepEqual(
		output.filter((line) => line.startsWith("id=")).map((line) => line.match(/^id="([^"]+)"/)?.[1]),
		[
			"public",
			"private-path",
			"private-case-variant",
			"private-empty-segment",
			"private-trailing-slash",
			"private-dot-segment",
			"private-dotdot-segment",
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
	const errors = [];
	const result = await backfillMediaRows({
		args: [],
		env: { UPLOADS_DIR: uploadsDirectory },
		pool: createBackfillPool([row]),
		log: () => undefined,
		errorLog: (line) => errors.push(String(line)),
	});

	assert.equal(result.found, 1);
	assert.equal(result.missing, 1);
	assert.equal(result.failed, 1);
	assert.equal(result.exitCode, 3);
	assert.equal(result.wouldFill, 0);
	assert.equal(row.content_hash, null);
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
	const writePool = createBackfillPool([freshRow()]);
	const writeResult = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: directory },
		pool: writePool,
		log: (line) => output.push(String(line)),
		errorLog: () => undefined,
	});
	assert.equal(writePool.rows[0].content_hash, await computeContentHash(bytes));
	assert.equal(writePool.rows[0].width, 2);
	assert.equal(writePool.rows[0].height, 1);
	assert.ok(writePool.rows[0].blurhash);
	assert.ok(writePool.rows[0].dominant_color);
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
		pool: writePool,
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
	const dryPool = createBackfillPool([dryRow]);
	const dryResult = await backfillMediaRows({
		args: [],
		env: { UPLOADS_DIR: directory },
		pool: dryPool,
		log: (line) => output.push(String(line)),
		errorLog: () => undefined,
	});
	assert.deepEqual(dryPool.rows[0], unchangedDryRow);
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
	const partialPool = createBackfillPool([partialRow]);
	const partialResult = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: directory },
		pool: partialPool,
		log: (line) => partialOutput.push(String(line)),
		errorLog: () => undefined,
	});
	assert.equal(partialPool.rows[0].content_hash, await computeContentHash(bytes));
	assert.equal(partialPool.rows[0].width, 640);
	assert.equal(partialPool.rows[0].height, null);
	assert.ok(partialPool.rows[0].blurhash);
	assert.ok(partialPool.rows[0].dominant_color);
	assert.equal(partialResult.filledByField.width, 0);
	assert.equal(partialResult.filledByField.height, 0);
	assert.ok(partialOutput.some((line) => line.includes("skipped: one dimension stored") && line.includes(partialRow.id)));

	const corruptBytes = Buffer.from("not a decodable image");
	await writeFile(path.join(directory, "work/corrupt.png"), corruptBytes);
	const badRowsPool = createBackfillPool([
		freshRow(),
		{ ...freshRow(), id: "corrupt-image-row", storage_key: "work/corrupt.png", size: corruptBytes.length },
		{ ...freshRow(), id: "missing-image-row", storage_key: "work/missing.png" },
	]);
	const failedOutput = [];
	const errors = [];
	const failedResult = await backfillMediaRows({
		args: ["--write"],
		env: { UPLOADS_DIR: directory },
		pool: badRowsPool,
		log: (line) => failedOutput.push(String(line)),
		errorLog: (line) => errors.push(String(line)),
	});
	assert.equal(failedResult.exitCode, 3);
	assert.equal(failedResult.failed, 2);
	assert.ok(failedOutput.includes("Failed rows: 2"));
	assert.ok(errors.some((line) => line.includes("corrupt-image-row") && line.includes("work/corrupt.png")));
	assert.ok(errors.some((line) => line.includes("missing-image-row") && line.includes("work/missing.png")));
	const goodRow = badRowsPool.rows.find((row) => row.id === "media-backfill-image");
	assert.equal(goodRow.content_hash, await computeContentHash(bytes));
	assert.equal(goodRow.width, 2);
	assert.equal(goodRow.height, 1);
	assert.ok(goodRow.blurhash);
	assert.ok(goodRow.dominant_color);
	for (const rowId of ["corrupt-image-row", "missing-image-row"]) {
		const row = badRowsPool.rows.find((candidate) => candidate.id === rowId);
		assert.equal(row.content_hash, null, `${rowId} remains unmodified`);
		assert.equal(row.width, null, `${rowId} dimensions remain unmodified`);
	}
	await assert.rejects(backfillMediaRows({ args: ["--invalid"], pool: writePool }), /Usage/);
});

test("cleanup rejects unset, root, symlink, and escaping cache paths", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "image-cache-guard-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const realCache = path.join(directory, "cache");
	const linkedCache = path.join(directory, "cache-link");
	await mkdir(realCache);
	await symlink(realCache, linkedCache, "dir");
	const pool = { async query() { return { rows: [] }; } };

	await assert.rejects(validateCacheDirectory(undefined), /IMAGE_CACHE_DIR must be set/);
	await assert.rejects(validateCacheDirectory("/"), /must not be the filesystem root/);
	await assert.rejects(validateCacheDirectory(linkedCache), /must not be a symbolic link/);
	await assert.rejects(
		cleanupImageCache({ env: { IMAGE_CACHE_DIR: linkedCache }, pool }),
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
	const pool = { async query() { return { rows }; } };
	const env = { IMAGE_CACHE_DIR: cacheDirectory };
	const options = {
		args: [],
		env,
		pool,
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
	const pool = {
		async query() {
			if (!variantPath) {
				variantPath = imageVariantCachePath(cacheDirectory, row.id, currentHash, 640, "webp", config);
				await mkdir(path.dirname(variantPath), { recursive: true });
				await writeFile(variantPath, "new publish");
			}
			return { rows: listed ? [row] : [] };
		},
	};
	const result = await cleanupImageCache({
		args: ["--delete"],
		env: { IMAGE_CACHE_DIR: cacheDirectory },
		pool,
		encoder: config.service.config,
		listCacheFiles,
		log: () => undefined,
	});
	assert.equal(result.deletedFiles, 0);
	assert.equal(await readFile(variantPath, "utf8"), "new publish");
});
