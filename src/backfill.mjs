import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { computeContentHash } from "emdash";
import { maintenanceDatabase } from "./maintenance-database.mjs";

const usage = "Usage: emdash-images backfill [--write]";
const metadataFields = ["width", "height", "blurhash", "dominant_color"];
const backfillFields = ["content_hash", ...metadataFields];

export function storageFilePath(uploadsDirectory, storageKey) {
	if (typeof storageKey !== "string" || !storageKey || storageKey.includes("\\")) {
		throw new TypeError("Media storage key is invalid.");
	}
	const segments = storageKey.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
		throw new TypeError("Media storage key is invalid.");
	}

	const root = path.resolve(uploadsDirectory);
	const target = path.resolve(root, storageKey);
	const relative = path.relative(root, target);
	if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new TypeError("Media storage key escapes the uploads directory.");
	}
	return target;
}

export async function hashStoredMediaFile(uploadsDirectory, storageKey) {
	const bytes = await readFile(storageFilePath(uploadsDirectory, storageKey));
	return computeContentHash(bytes);
}

export function parseArguments(args) {
	const write = args.includes("--write");
	if (args.some((argument) => argument !== "--write") || args.filter((argument) => argument === "--write").length > 1) {
		throw new TypeError(usage);
	}
	return { write };
}

async function listCandidate(row, uploadsDirectory, deniedPrefixes) {
	const candidate = {
		row,
		id: row.id,
		storageKey: row.storage_key,
		mimeType: row.mime_type,
		size: row.size,
		filePath: undefined,
		missing: false,
		failureReason: undefined,
		missingFields: missingFields(row, deniedPrefixes),
	};
	try {
		candidate.filePath = storageFilePath(uploadsDirectory, candidate.storageKey);
		if (!(await stat(candidate.filePath)).isFile()) {
			candidate.missing = true;
			candidate.failureReason = "original file is not a regular file";
		}
	} catch (error) {
		candidate.missing = true;
		candidate.failureReason = shortFailureReason(error);
	}
	return candidate;
}

function shortFailureReason(error) {
	if (error?.code === "ENOENT") return "original file is missing";
	if (error?.code === "EACCES" || error?.code === "EPERM") return "original file is not readable";
	const message = String(error instanceof Error ? error.message : error || "could not read original file")
		.split(/\r?\n/, 1)[0]
		.trim();
	return message.slice(0, 240) || "could not read original file";
}

function isPublicImageRow(row, deniedPrefixes) {
	return typeof row.mime_type === "string" && row.mime_type.toLowerCase().startsWith("image/") &&
		typeof row.storage_key === "string" && !isDeniedStorageKey(row.storage_key, deniedPrefixes);
}

function isMissingValue(field, value) {
	if (field === "width" || field === "height") return value == null;
	return value == null || value === "";
}

function missingFields(row, deniedPrefixes) {
	const fields = [];
	if (isMissingValue("content_hash", row.content_hash)) fields.push("content_hash");
	if (isPublicImageRow(row, deniedPrefixes)) {
		for (const field of metadataFields) {
			if (isMissingValue(field, row[field])) fields.push(field);
		}
	}
	return fields;
}

function emptyCounts() {
	return Object.fromEntries(backfillFields.map((field) => [field, 0]));
}

async function readCandidateUpdates(candidate) {
	const bytes = await readFile(candidate.filePath);
	const updates = {};
	if (candidate.missingFields.includes("content_hash")) {
		updates.content_hash = await computeContentHash(bytes);
	}

	if (candidate.missingFields.some((field) => metadataFields.includes(field))) {
		const [{ default: sharp }, { enrichImageMetadata }] = await Promise.all([
			import("sharp"),
			import("emdash/media"),
		]);
		const thumbnail = new Uint8Array(await sharp(bytes)
			.resize({ width: 32, height: 32, fit: "inside", withoutEnlargement: true })
			.png()
			.toBuffer());
		const knownDimensions = typeof candidate.row.width === "number" && candidate.row.width > 0 &&
			typeof candidate.row.height === "number" && candidate.row.height > 0
			? { width: candidate.row.width, height: candidate.row.height }
			: undefined;
		const enriched = await enrichImageMetadata(bytes, candidate.mimeType, {
			knownDimensions,
			placeholder: { bytes: thumbnail, contentType: "image/png" },
		});
		const enrichedFields = {
			width: enriched.width,
			height: enriched.height,
			blurhash: enriched.blurhash,
			dominant_color: enriched.dominantColor,
		};
		const hasOneStoredDimension = (candidate.row.width == null) !== (candidate.row.height == null);
		for (const field of metadataFields) {
			if (hasOneStoredDimension && (field === "width" || field === "height")) continue;
			if (candidate.missingFields.includes(field) && !isMissingValue(field, enrichedFields[field])) {
				updates[field] = enrichedFields[field];
			}
		}
	}
	return updates;
}

async function fillMissingField(database, candidate, field, value) {
	const update = await database
		.updateTable("media")
		.set({ [field]: value })
		.where("id", "=", candidate.id)
		.where("storage_key", "=", candidate.storageKey)
		.where("status", "=", "ready")
		.where((eb) => field === "width" || field === "height"
			? eb(field, "is", null)
			: eb.or([eb(field, "is", null), eb(field, "=", "")]))
		.executeTakeFirst();
	return update.numUpdatedRows === 1n;
}

function normalizeDeniedStorageKeyPrefixes(prefixes) {
	if (!Array.isArray(prefixes)) return [];
	return prefixes.map((prefix) => {
		if (typeof prefix !== "string" || !prefix.trim()) return null;
		const normalized = prefix.trim().replace(/\/+$/, "");
		if (!normalized || normalized.includes("\\")) return null;
		const segments = normalized.split("/");
		if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
		return normalized.toLowerCase();
	}).filter(Boolean);
}

function isDeniedStorageKey(key, deniedPrefixes) {
	if (typeof key !== "string") return false;
	const normalizedKey = key.toLowerCase();
	return deniedPrefixes.some((prefix) => normalizedKey === prefix || normalizedKey.startsWith(`${prefix}/`));
}

export async function backfillMediaRows({
	args = [],
	env = process.env,
	database: suppliedDatabase,
	pool,
	deniedStorageKeyPrefixes = [],
	log = console.log,
	errorLog = console.error,
} = {}) {
	const { write } = parseArguments(args);
	const uploadsDirectory = path.resolve(env.UPLOADS_DIR?.trim() || "uploads");
	const deniedPrefixes = normalizeDeniedStorageKeyPrefixes(deniedStorageKeyPrefixes);
	const maintenance = await maintenanceDatabase({ database: suppliedDatabase, pool, env });
	const { database } = maintenance;
	try {
		const rows = await database
			.selectFrom("media")
			.select(["id", "storage_key", "size", "mime_type", "content_hash", "width", "height", "blurhash", "dominant_color"])
			.where("status", "=", "ready")
			.where((eb) => eb.or([
				eb("content_hash", "is", null),
				eb("content_hash", "=", ""),
				eb("width", "is", null),
				eb("height", "is", null),
				eb("blurhash", "is", null),
				eb("blurhash", "=", ""),
				eb("dominant_color", "is", null),
				eb("dominant_color", "=", ""),
			]))
			.orderBy("id")
			.execute();
		log(`Content hash and image metadata backfill (${write ? "write" : "dry run"})`);
		const candidates = [];
		for (const row of rows.filter((entry) => missingFields(entry, deniedPrefixes).length > 0)) {
			const candidate = await listCandidate(row, uploadsDirectory, deniedPrefixes);
			candidates.push(candidate);
			log(`id=${JSON.stringify(candidate.id)} storage_key=${JSON.stringify(candidate.storageKey)} size=${candidate.size ?? "unknown"} missing_fields=${candidate.missingFields.join(",")}${candidate.missing ? " missing-file" : ""}`);
		}

		const missing = candidates.filter((candidate) => candidate.missing);
		const missingByField = emptyCounts();
		for (const candidate of candidates) {
			for (const field of candidate.missingFields) missingByField[field]++;
		}
		log(`Rows needing backfill: ${candidates.length}`);
		for (const field of backfillFields) log(`Rows missing ${field}: ${missingByField[field]}`);
		log(`Files available: ${candidates.length - missing.length}`);
		log(`Missing files: ${missing.length}`);
		for (const candidate of candidates) {
			if ((candidate.row.width == null) !== (candidate.row.height == null)) {
				log(`skipped: one dimension stored id=${JSON.stringify(candidate.id)}`);
			}
		}

		const updatesByCandidate = new Map();
		const failures = [];
		const reportFailure = (candidate, error) => {
			const reason = shortFailureReason(error);
			failures.push({ id: candidate.id, storageKey: candidate.storageKey, reason });
			errorLog(`Failed row id=${JSON.stringify(candidate.id)} storage_key=${JSON.stringify(candidate.storageKey)} reason=${JSON.stringify(reason)}`);
		};
		for (const candidate of candidates) {
			if (candidate.failureReason) {
				reportFailure(candidate, candidate.failureReason);
				continue;
			}
			try {
				updatesByCandidate.set(candidate, await readCandidateUpdates(candidate));
			} catch (error) {
				reportFailure(candidate, error);
			}
		}

		const wouldFillByField = emptyCounts();
		for (const updates of updatesByCandidate.values()) {
			for (const field of Object.keys(updates)) wouldFillByField[field]++;
		}
		if (!write) {
			for (const field of backfillFields) log(`Would fill ${field}: ${wouldFillByField[field]}`);
			log("Changes written: 0");
			log(`Failed rows: ${failures.length}`);
			return {
				found: candidates.length,
				wouldFill: Object.values(wouldFillByField).reduce((sum, count) => sum + count, 0),
				wouldFillByField,
				filled: 0,
				filledByField: emptyCounts(),
				missing: missing.length,
				failed: failures.length,
				exitCode: failures.length > 0 ? 3 : 0,
			};
		}

		const filledByField = emptyCounts();
		let skipped = 0;
		for (const [candidate, updates] of updatesByCandidate) {
			for (const [field, value] of Object.entries(updates)) {
				if (await fillMissingField(database, candidate, field, value)) filledByField[field]++;
				else skipped++;
			}
		}
		for (const field of backfillFields) log(`Filled ${field}: ${filledByField[field]}`);
		log(`Skipped because rows changed: ${skipped}`);
		const filled = Object.values(filledByField).reduce((sum, count) => sum + count, 0);
		log(`Changes written: ${filled}`);
		log(`Failed rows: ${failures.length}`);
		return {
			found: candidates.length,
			filled,
			filledByField,
			skipped,
			missing: missing.length,
			failed: failures.length,
			exitCode: failures.length > 0 ? 3 : 0,
		};
	} finally {
		await maintenance.close();
	}
}
