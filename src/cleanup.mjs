import { lstat, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

import {
	contentHashVersion,
	imageCacheSettings8,
	imageCacheNamespaceFromPath,
	parseImageVariantCachePath,
	imageVariantCachePath,
} from "./layout.mjs";
import { DEFAULT_IMAGE_OPTIONS } from "./options.mjs";

const usage = "Usage: emdash-images cleanup [--delete] | --help";
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const flatCacheNamePattern = /^[a-f\d]{64}\.(?:avif|webp)$/i;
const categoryNames = [
	"missing-media-row",
	"not-ready",
	"private-storage-key",
	"hash-mismatch",
	"old-v2-namespace",
	"legacy-flat-layout",
	"stale-temp-file",
	"kept-no-content-hash",
];

export function parseArguments(args) {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		return { deleteFiles: false, help: true };
	}
	if (args.length > 1 || args.some((argument) => argument !== "--delete")) {
		throw new TypeError(usage);
	}
	return { deleteFiles: args[0] === "--delete", help: false };
}

export function assertPathInsideCache(cacheDirectory, candidatePath) {
	const root = path.resolve(cacheDirectory);
	const candidate = path.resolve(candidatePath);
	const relative = path.relative(root, candidate);
	if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new TypeError(`Path escapes IMAGE_CACHE_DIR: ${candidate}`);
	}
	return candidate;
}

function assertDirectoryInsideCache(cacheDirectory, candidatePath) {
	const root = path.resolve(cacheDirectory);
	const candidate = path.resolve(candidatePath);
	const relative = path.relative(root, candidate);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new TypeError(`Path escapes IMAGE_CACHE_DIR: ${candidate}`);
	}
	return candidate;
}

async function lstatCachePath(cacheDirectory, candidatePath, allowRoot = false) {
	const target = allowRoot
		? assertDirectoryInsideCache(cacheDirectory, candidatePath)
		: assertPathInsideCache(cacheDirectory, candidatePath);
	const relative = path.relative(cacheDirectory, target);
	let current = cacheDirectory;
	let info = await lstat(current);
	if (info.isSymbolicLink() || !info.isDirectory()) return undefined;
	if (!relative) return info;
	const segments = relative.split(path.sep);
	for (let index = 0; index < segments.length; index++) {
		current = path.join(current, segments[index]);
		info = await lstat(current);
		if (info.isSymbolicLink()) return undefined;
		if (index < segments.length - 1 && !info.isDirectory()) return undefined;
	}
	return info;
}

export async function validateCacheDirectory(value) {
	if (typeof value !== "string" || !value.trim()) {
		throw new TypeError("IMAGE_CACHE_DIR must be set to an existing directory.");
	}
	const requestedPath = path.resolve(value.trim());
	if (requestedPath === path.parse(requestedPath).root) {
		throw new TypeError("IMAGE_CACHE_DIR must not be the filesystem root.");
	}

	let info;
	try {
		info = await lstat(requestedPath);
	} catch {
		throw new TypeError("IMAGE_CACHE_DIR must be an existing directory and must not be a symbolic link.");
	}
	if (info.isSymbolicLink()) {
		throw new TypeError("IMAGE_CACHE_DIR must not be a symbolic link.");
	}
	if (!info.isDirectory()) {
		throw new TypeError("IMAGE_CACHE_DIR must be an existing directory.");
	}

	const resolvedPath = await realpath(requestedPath);
	if (resolvedPath === path.parse(resolvedPath).root) {
		throw new TypeError("IMAGE_CACHE_DIR must not be the filesystem root.");
	}
	return resolvedPath;
}

function databaseConfig(env) {
	const connectionString = env.DATABASE_URL || env.EMDASH_DATABASE_URL;
	if (connectionString) return { connectionString };
	if (!env.PGDATABASE || !env.PGUSER || !env.PGHOST) {
		throw new Error("Set DATABASE_URL or the PGHOST, PGDATABASE, and PGUSER variables.");
	}
	return {
		host: env.PGHOST,
		port: Number(env.PGPORT || 5432),
		database: env.PGDATABASE,
		user: env.PGUSER,
		password: env.PGPASSWORD,
	};
}

async function listRegularFiles(cacheDirectory) {
	const files = [];
	async function visit(directory) {
		const directoryInfo = await lstatCachePath(cacheDirectory, directory, true);
		if (!directoryInfo?.isDirectory()) return;

		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const target = assertPathInsideCache(cacheDirectory, path.join(directory, entry.name));
			if (entry.isSymbolicLink()) continue;
			const info = await lstatCachePath(cacheDirectory, target);
			if (!info) continue;
			if (info.isDirectory()) {
				await visit(target);
				continue;
			}
			if (!info.isFile()) continue;
			files.push({ path: target, relativePath: path.relative(cacheDirectory, target), size: info.size, mtimeMs: info.mtimeMs });
		}
	}

	await visit(cacheDirectory);
	return files;
}

function mediaRowsById(rows) {
	return new Map(rows
		.filter((row) => row && row.id !== undefined && row.id !== null)
		.map((row) => [String(row.id), row]));
}

function classifyFiles(files, cacheDirectory, rows, settings8, imageConfig, deniedPrefixes, now) {
	const namespace = `v2-${settings8}`;
	const categories = new Map();
	const add = (category, file) => {
		const candidates = categories.get(category) ?? [];
		candidates.push({ category, ...file });
		categories.set(category, candidates);
	};

	for (const file of files) {
		const segments = file.relativePath.split(path.sep);
		const first = segments[0];
		const basename = path.basename(file.path);

		if (basename.startsWith(".") && basename.endsWith(".tmp")) {
			if (file.mtimeMs < now - TEMP_FILE_MAX_AGE_MS) add("stale-temp-file", file);
			continue;
		}

		const fileNamespace = imageCacheNamespaceFromPath(cacheDirectory, file.path);
		if (fileNamespace && fileNamespace !== namespace) {
			add("old-v2-namespace", file);
			continue;
		}

		if (fileNamespace === namespace) {
			const variant = parseImageVariantCachePath(cacheDirectory, file.path);
			if (!variant) continue;
			const { mediaId, hash16, width, format } = variant;
			const expectedPath = imageVariantCachePath(cacheDirectory, mediaId, hash16, width, format, imageConfig);
			if (path.resolve(expectedPath) !== path.resolve(file.path)) continue;

			const row = rows.get(mediaId);
			if (!row) add("missing-media-row", file);
			else if (row.status !== "ready") add("not-ready", file);
			else if (typeof row.storage_key === "string" && isDeniedStorageKey(row.storage_key, deniedPrefixes)) add("private-storage-key", file);
			else if (typeof row.content_hash === "string" && row.content_hash.trim()) {
				const currentHash = contentHashVersion(row.content_hash);
				if (!currentHash || currentHash !== hash16) add("hash-mismatch", file);
			} else add("kept-no-content-hash", file);
			continue;
		}

		if (
			segments.length === 2 && /^[a-f\d]{2}$/i.test(first) && flatCacheNamePattern.test(basename) &&
			basename.slice(0, 2).toLowerCase() === first.toLowerCase()
		) {
			add("legacy-flat-layout", file);
		}
	}

	return categories;
}

function isDeniedStorageKey(key, deniedPrefixes) {
	const normalizedKey = normalizeStorageKeyForGuard(key);
	if (normalizedKey === null) return false;
	return deniedPrefixes.some((prefix) => normalizedKey === prefix || normalizedKey.startsWith(`${prefix}/`));
}

function normalizeStorageKeyForGuard(key) {
	if (typeof key !== "string" || key.length === 0 || key.includes("\\")) return null;
	const segments = key.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
	return key.toLowerCase();
}

function normalizeStorageKeyPrefix(prefix) {
	if (typeof prefix !== "string" || prefix.length === 0 || prefix.includes("\\")) return null;
	const segments = prefix.replace(/\/+$/, "").split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
	return segments.join("/").toLowerCase();
}

function summarizeCategories(categories) {
	return Object.fromEntries(categoryNames.map((name) => {
		const files = categories.get(name) ?? [];
		return [name, {
			count: files.length,
			bytes: files.reduce((total, file) => total + file.size, 0),
			files,
		}];
	}));
}

async function removeCandidate(cacheDirectory, candidate) {
	const target = assertPathInsideCache(cacheDirectory, candidate.path);
	const info = await lstatCachePath(cacheDirectory, target);
	if (!info?.isFile()) return false;
	await unlink(target);
	return true;
}

async function removeEmptyParentDirectories(cacheDirectory, filePath) {
	const cacheRoot = path.resolve(cacheDirectory);
	let directory = path.dirname(filePath);
	while (directory !== cacheRoot) {
		const target = assertDirectoryInsideCache(cacheRoot, directory);
		const info = await lstatCachePath(cacheRoot, target, true);
		if (!info?.isDirectory()) return;
		if ((await readdir(target)).length > 0) return;
		try {
			await rmdir(target);
		} catch (error) {
			if (error?.code === "ENOENT" || error?.code === "ENOTEMPTY") return;
			throw error;
		}
		directory = path.dirname(directory);
	}
}

async function removeEmptyDirectories(cacheDirectory, directory = cacheDirectory) {
	const cacheRoot = path.resolve(cacheDirectory);
	const target = assertDirectoryInsideCache(cacheRoot, directory);
	const info = await lstatCachePath(cacheRoot, target, true);
	if (!info?.isDirectory()) return;

	for (const entry of await readdir(target, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		const child = assertDirectoryInsideCache(cacheRoot, path.join(target, entry.name));
		await removeEmptyDirectories(cacheRoot, child);
	}

	if (target === cacheRoot || (await readdir(target)).length > 0) return;
	try {
		await rmdir(target);
	} catch (error) {
		if (error?.code === "ENOENT" || error?.code === "ENOTEMPTY") return;
		throw error;
	}
}

function inspectCacheSnapshot(cacheDirectory, files, rows, settings8, imageConfig, deniedPrefixes, now) {
	const categories = classifyFiles(files, cacheDirectory, mediaRowsById(rows), settings8, imageConfig, deniedPrefixes, now);
	const candidates = [...categories.entries()]
		.filter(([category]) => category !== "kept-no-content-hash")
		.flatMap(([, filesForCategory]) => filesForCategory);
	return {
		files,
		categories,
		candidates,
		totalBytes: files.reduce((total, file) => total + file.size, 0),
	};
}

function printSummary(summary, log) {
	log(`Image cache cleanup (${summary.mode})`);
	log(`IMAGE_CACHE_DIR: ${summary.cacheDirectory}`);
	log(`Total cache size before: ${summary.totalBytesBefore} bytes`);
	for (const [category, group] of Object.entries(summary.categories)) {
		log(`${category}: ${group.count} files, ${group.bytes} bytes`);
		for (const file of group.files) {
			const action = category === "kept-no-content-hash"
				? "Kept"
				: summary.mode === "delete" ? "Deleted" : "Would delete";
			log(`${action}: ${file.relativePath} (${file.size} bytes)`);
		}
	}
	log(`Candidates: ${summary.candidateCountBefore} files, ${summary.candidateBytes} bytes`);
	log(`Deleted: ${summary.deletedFiles} files`);
	log(`Total cache size after: ${summary.totalBytesAfter} bytes`);
}

function normalizeDeniedStorageKeyPrefixes(prefixes) {
	if (!Array.isArray(prefixes)) return [];
	return prefixes.map(normalizeStorageKeyPrefix).filter(Boolean);
}

export async function cleanupImageCache({
	args = [],
	env = process.env,
	pool: suppliedPool,
	now = Date.now(),
	log = console.log,
	listCacheFiles = listRegularFiles,
	encoder = DEFAULT_IMAGE_OPTIONS.encoder,
	deniedStorageKeyPrefixes = [],
} = {}) {
	const { deleteFiles, help } = parseArguments(args);
	if (help) {
		log(usage);
		return { mode: "help" };
	}
	const cacheDirectory = await validateCacheDirectory(env.IMAGE_CACHE_DIR);
	const imageConfig = { service: { config: encoder } };
	const deniedPrefixes = normalizeDeniedStorageKeyPrefixes(deniedStorageKeyPrefixes);
	const settings8 = imageCacheSettings8(imageConfig);
	const pool = suppliedPool ?? new Pool(databaseConfig(env));

	try {
		const beforeFiles = await listCacheFiles(cacheDirectory);
		const beforeRows = await pool.query("SELECT id, status, storage_key, content_hash FROM media ORDER BY id");
		const before = inspectCacheSnapshot(cacheDirectory, beforeFiles, beforeRows.rows ?? [], settings8, imageConfig, deniedPrefixes, now);
		let deletedFiles = 0;
		if (deleteFiles) {
			for (const candidate of before.candidates) {
				if (await removeCandidate(cacheDirectory, candidate)) {
					deletedFiles++;
					await removeEmptyParentDirectories(cacheDirectory, candidate.path);
				}
			}
			await removeEmptyDirectories(cacheDirectory);
		}
		let after = before;
		if (deleteFiles) {
			const afterFiles = await listCacheFiles(cacheDirectory);
			const afterRows = await pool.query("SELECT id, status, storage_key, content_hash FROM media ORDER BY id");
			after = inspectCacheSnapshot(cacheDirectory, afterFiles, afterRows.rows ?? [], settings8, imageConfig, deniedPrefixes, now);
		}
		const summary = {
			mode: deleteFiles ? "delete" : "dry run",
			cacheDirectory,
			settings8,
			categories: summarizeCategories(before.categories),
			candidates: before.candidates,
			candidateCountBefore: before.candidates.length,
			candidateBytes: before.candidates.reduce((total, file) => total + file.size, 0),
			candidateCountAfter: after.candidates.length,
			deletedFiles,
			totalBytesBefore: before.totalBytes,
			totalBytesAfter: after.totalBytes,
		};
		printSummary(summary, log);
		return summary;
	} finally {
		if (!suppliedPool) await pool.end();
	}
}
