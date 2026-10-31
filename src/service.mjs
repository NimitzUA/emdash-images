import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeContentHash } from "emdash";
import sharpService from "astro/assets/services/sharp";
import sharp from "sharp";
import { DEFAULT_IMAGE_OPTIONS } from "./options.mjs";
import { contentHashVersion, imageVariantCachePath } from "./layout.mjs";

export {
	contentHashVersion,
	imageCacheSettings8,
	imageVariantCachePath,
} from "./layout.mjs";

export const PUBLIC_IMAGE_ENCODER_CONFIG = DEFAULT_IMAGE_OPTIONS.encoder;
export const PUBLIC_IMAGE_SMALL_WIDTHS = DEFAULT_IMAGE_OPTIONS.smallWidths;
export const PUBLIC_IMAGE_WIDTHS = DEFAULT_IMAGE_OPTIONS.publicWidths;
export const PRIVATE_IMAGE_WIDTHS = DEFAULT_IMAGE_OPTIONS.privateWidths;
const imageFormats = new Set(["avif", "webp"]);
const imageRequestParameters = new Set(["href", "w", "f", "fit", "v"]);
const imageVersionPattern = /^[0-9a-f]{16}$/;
const defaultCacheDirectory = ".dev/image-cache";
const mediaIdPattern = /^[A-Za-z0-9_-]+$/;
const imageEncodeLimiterKey = Symbol.for("@nimitzua/emdash-images.image-encode-limiter");
const imageEncodeLimiters = globalThis[imageEncodeLimiterKey] ??= new Map();
const imageCacheContextKey = Symbol.for("@nimitzua/emdash-images.image-cache-context");
const imageCacheContext = globalThis[imageCacheContextKey] ??= new AsyncLocalStorage();

function serviceConfig(imageConfig) {
	return imageConfig?.service?.config ?? {};
}

function configuredWidths(imageConfig) {
	const config = serviceConfig(imageConfig);
	const publicWidths = Array.isArray(config.publicWidths) ? config.publicWidths : DEFAULT_IMAGE_OPTIONS.publicWidths;
	const smallWidths = Array.isArray(config.smallWidths) ? config.smallWidths : DEFAULT_IMAGE_OPTIONS.smallWidths;
	return { publicWidths, smallWidths, allWidths: new Set([...smallWidths, ...publicWidths]) };
}

function isPublicTransformWidth(width, imageConfig) {
	const { publicWidths, allWidths } = configuredWidths(imageConfig);
	const minimumStandardPublicWidth = Math.min(...publicWidths);
	return allWidths.has(width) || (
		Number.isSafeInteger(width) && width > 0 && width < minimumStandardPublicWidth
	);
}

export function isPublicImageWidthAllowed(width, originalWidth, imageConfig) {
	if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(originalWidth) || originalWidth <= 0 || width > originalWidth) {
		return false;
	}
	const { publicWidths, smallWidths, allWidths } = configuredWidths(imageConfig);
	const minimumStandardPublicWidth = Math.min(...publicWidths);
	if (smallWidths.includes(width)) return width < originalWidth;
	if (allWidths.has(width)) return true;
	return width < minimumStandardPublicWidth && width === originalWidth;
}

export function runWithImageCacheContext(context, callback) {
	return imageCacheContext.run(context, callback);
}

export function createImageEncodeLimiter(limit = 2) {
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Image encode limit must be a positive integer.");
	let running = 0;
	const queue = [];

	return async function withImageEncodeLimit(operation) {
		if (running >= limit) await new Promise((resolve) => queue.push(resolve));
		else running++;

		try {
			return await operation();
		} finally {
			const next = queue.shift();
			if (next) next();
			else running--;
		}
	};
}

export function runWithImageEncodeLimit(operation, limit = DEFAULT_IMAGE_OPTIONS.encodeLimit) {
	let limiter = imageEncodeLimiters.get(limit);
	if (!limiter) {
		limiter = createImageEncodeLimiter(limit);
		imageEncodeLimiters.set(limit, limiter);
	}
	return limiter(operation);
}

export function publicResponsiveImageWidths(originalWidth, srcsetWidths, options = DEFAULT_IMAGE_OPTIONS) {
	if (!Number.isFinite(originalWidth) || originalWidth <= 0) return [];

	const publicWidths = options.publicWidths ?? DEFAULT_IMAGE_OPTIONS.publicWidths;
	const smallWidths = options.smallWidths ?? DEFAULT_IMAGE_OPTIONS.smallWidths;
	const allowedWidths = new Set([...publicWidths, ...smallWidths]);
	const candidates = srcsetWidths === undefined
		? publicWidths
		: [...publicWidths, ...srcsetWidths];
	return [...new Set(candidates)]
		.filter((width) => allowedWidths.has(width) && width <= originalWidth)
		.sort((left, right) => left - right);
}

function forwardWarnings(warnings, logger) {
	for (const args of warnings) {
		if (logger?.warn) logger.warn(...args);
		else console.warn(...args);
	}
}

export function createImageService(service = sharpService, options = {}) {
	const inFlight = new Map();
	const cacheStates = new Map();

	function getCacheDirectory(imageConfig) {
		const configuredCacheDirectory = process.env.IMAGE_CACHE_DIR?.trim()
			|| serviceConfig(imageConfig).cacheDirectory
			|| options.cacheDirectory;
		return path.resolve(
			typeof configuredCacheDirectory === "string" && configuredCacheDirectory.trim()
				? configuredCacheDirectory
				: defaultCacheDirectory,
		);
	}

	function getCacheState(cacheDirectory) {
		let state = cacheStates.get(cacheDirectory);
		if (!state) {
			state = { cacheDirectoryCheck: undefined, cacheWritesDisabled: false, cacheErrorReported: false };
			cacheStates.set(cacheDirectory, state);
		}
		return state;
	}

	async function ensureCacheDirectoryWritable(cacheDirectory, state) {
		if (!state.cacheDirectoryCheck) {
			state.cacheDirectoryCheck = (async () => {
				let probePath;
				try {
					await mkdir(cacheDirectory, { recursive: true });
					probePath = path.join(cacheDirectory, `.write-check.${process.pid}.${randomUUID()}`);
					await writeFile(probePath, new Uint8Array(), { flag: "wx", mode: 0o600 });
					await unlink(probePath);
					return true;
				} catch (error) {
					if (probePath) await unlink(probePath).catch(() => undefined);
					reportCacheError(state, error);
					return false;
				}
			})();
		}
		return state.cacheDirectoryCheck;
	}

	function reportCacheError(state, error) {
		if (state.cacheErrorReported) return;
		state.cacheErrorReported = true;
		console.error(`[image-cache] Cache directory is not writable; public transforms will not be persisted: ${error instanceof Error ? error.message : String(error)}`);
	}

	function withEncodeLimit(imageConfig) {
		if (options.encodeLimiter) return options.encodeLimiter;
		return (operation) => runWithImageEncodeLimit(operation, serviceConfig(imageConfig).encodeLimit ?? DEFAULT_IMAGE_OPTIONS.encodeLimit);
	}

	return {
		...service,
		getURL(imageTransform, imageConfig, logger) {
			if (typeof service.getURL !== "function") return undefined;
			const { mediaVersion, ...transform } = imageTransform ?? {};
			const generated = service.getURL(normalizeGeneratedTransform(transform, imageConfig), imageConfig, logger);
			if (generated && typeof generated.then === "function") {
				return generated.then((url) => appendMediaVersion(url, transform.src, mediaVersion, imageConfig));
			}
			return appendMediaVersion(generated, transform.src, mediaVersion, imageConfig);
		},
		getHTMLAttributes(imageTransform, imageConfig, logger) {
			if (typeof service.getHTMLAttributes !== "function") return undefined;
			const { mediaVersion: _mediaVersion, ...transform } = imageTransform ?? {};
			return service.getHTMLAttributes(transform, imageConfig, logger);
		},
		async parseURL(url, imageConfig, logger) {
			if (typeof service.parseURL !== "function") return undefined;
			const parameterNames = new Set();
			for (const [name] of url.searchParams) {
				if (!imageRequestParameters.has(name)) return undefined;
				if (parameterNames.has(name)) return undefined;
				parameterNames.add(name);
			}
			const versions = url.searchParams.getAll("v");
			if (versions.length > 1 || (versions.length === 1 && !imageVersionPattern.test(versions[0]))) return undefined;

			const transform = await service.parseURL(url, imageConfig, logger);
			if (!transform || typeof transform.src !== "string") return undefined;

			// Astro's remote-source configuration authorizes hosts; request origins vary behind proxies.
			const source = mediaSource(transform.src, imageConfig);
			if (!source) return undefined;

			const widthValue = url.searchParams.get("w");
			const format = url.searchParams.get("f");
			const fit = url.searchParams.get("fit");
			const validWidth = Number.isSafeInteger(transform.width) && transform.width > 0;
			if (
				url.searchParams.getAll("href").length !== 1 ||
				widthValue !== String(transform.width) ||
				!validWidth ||
				(source.kind === "public" && !isPublicTransformWidth(transform.width, imageConfig)) ||
				url.searchParams.getAll("w").length !== 1 ||
				url.searchParams.getAll("f").length !== 1 ||
				url.searchParams.has("h") ||
				(transform.height !== undefined && transform.height !== null) ||
				!imageFormats.has(format) ||
				url.searchParams.has("q") ||
				(url.searchParams.has("fit") && (fit !== "cover" || url.searchParams.getAll("fit").length !== 1)) ||
				url.searchParams.has("position") ||
				url.searchParams.has("background")
			) {
				return undefined;
			}

			return transform;
		},
		async getCachedVariant(media, transform, imageConfig) {
			if (
				media?.status !== "ready" ||
				typeof media.id !== "string" || !mediaIdPattern.test(media.id) ||
				typeof media.storage_key !== "string" || isDeniedStorageKey(media.storage_key, serviceConfig(imageConfig).deniedStorageKeyPrefixes) ||
				!Number.isSafeInteger(media.width) || media.width <= 0 ||
				!isPublicImageWidthAllowed(transform?.width, media.width, imageConfig) ||
				!imageFormats.has(transform?.format)
			) return undefined;
			const hash16 = contentHashVersion(media.content_hash);
			if (!hash16) return undefined;
			const cacheDirectory = getCacheDirectory(imageConfig);
			return openCachedVariant(imageVariantCachePath(cacheDirectory, media.id, hash16, transform.width, transform.format, imageConfig));
		},
		async transform(inputBuffer, transform, imageConfig, logger) {
			const source = mediaSource(transform.src, imageConfig);
			const requestContext = imageCacheContext.getStore();
			const withImageEncodeLimit = withEncodeLimit(imageConfig);
			if (source?.kind === "public") {
				const sourceWidth = await getSourceWidth(inputBuffer, requestContext?.originalWidth);
				if (!isPublicImageWidthAllowed(transform.width, sourceWidth, imageConfig)) throw new Error("Image variant not found");
			}

			const cacheDirectory = getCacheDirectory(imageConfig);
			const cacheState = getCacheState(cacheDirectory);
			const cacheIdentity = await createCacheIdentity(inputBuffer, transform, imageConfig, requestContext, cacheDirectory);
			if (!cacheIdentity) return transformWithFallback(service, inputBuffer, transform, imageConfig, logger, withImageEncodeLimit);

			const cachePath = cacheIdentity.path;
			const cacheWritable = await ensureCacheDirectoryWritable(cacheDirectory, cacheState);
			const cached = await readCachedVariant(cachePath);
			if (cached) return { data: cached, format: cacheIdentity.format };
			if (!cacheWritable || cacheState.cacheWritesDisabled) {
				return transformWithFallback(service, inputBuffer, transform, imageConfig, logger, withImageEncodeLimit);
			}

			const existing = inFlight.get(cachePath);
			if (existing) return existing;

			const pending = (async () => {
				const result = await transformWithFallback(service, inputBuffer, transform, imageConfig, logger, withImageEncodeLimit);
				if (result.format === cacheIdentity.format) {
					try {
						await writeCachedVariant(cachePath, result.data);
					} catch (error) {
						cacheState.cacheWritesDisabled = true;
						reportCacheError(cacheState, error);
					}
				}
				return result;
			})();
			inFlight.set(cachePath, pending);
			try {
				return await pending;
			} finally {
				if (inFlight.get(cachePath) === pending) inFlight.delete(cachePath);
			}
		},
	};
}

function appendMediaVersion(imageUrl, sourceUrl, mediaVersion, imageConfig) {
	if (
		typeof imageUrl !== "string" ||
		!imageVersionPattern.test(mediaVersion ?? "") ||
		mediaSource(sourceUrl, imageConfig)?.kind !== "public"
	) return imageUrl;

	try {
		const url = new URL(imageUrl, "http://localhost");
		url.searchParams.set("v", mediaVersion);
		return /^[a-z][a-z\d+.-]*:/i.test(imageUrl)
			? url.href
			: `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return imageUrl;
	}
}

async function transformWithFallback(service, inputBuffer, transform, imageConfig, logger, withImageEncodeLimit) {
	const warnings = [];
	const transformLogger = { warn: (...args) => warnings.push(args) };
	const runTransform = () => withImageEncodeLimit(() => service.transform(inputBuffer, transform, imageConfig, transformLogger));

	const first = await runTransform();
	if (!transform.format || first.format === transform.format) {
		forwardWarnings(warnings, logger);
		return first;
	}

	warnings.length = 0;
	const retry = await runTransform();
	if (retry.format === transform.format) {
		forwardWarnings(warnings, logger);
		return retry;
	}

	const dimensions = `${transform.width ?? "?"}x${transform.height ?? "?"}`;
	console.warn(
		`[image-service] source=${transform.src} requested=${transform.format} returned=${retry.format} size=${dimensions}, ${retry.data.byteLength} bytes`,
	);
	throw new Error(`Image encoder returned ${retry.format} after retry for requested ${transform.format}.`);
}

function normalizeGeneratedTransform(imageTransform, imageConfig) {
	const sourceUrl = typeof imageTransform?.src === "string" ? imageTransform.src : imageTransform?.src?.src;
	if (mediaSource(sourceUrl, imageConfig)?.kind !== "public") return imageTransform;
	return {
		...imageTransform,
		height: undefined,
		fit: imageTransform.fit ? "cover" : undefined,
		position: undefined,
	};
}

async function createCacheIdentity(inputBuffer, transform, imageConfig, requestContext, cacheDirectory) {
	const source = mediaSource(transform.src, imageConfig);
	if (
		source?.kind !== "public" ||
		!requestContext ||
		typeof requestContext.mediaId !== "string" || !mediaIdPattern.test(requestContext.mediaId) ||
		!isPublicTransformWidth(transform.width, imageConfig) ||
		(transform.height !== undefined && transform.height !== null) ||
		!imageFormats.has(transform.format) ||
		(transform.quality !== undefined && transform.quality !== null && transform.quality !== "") ||
		(transform.position !== undefined && transform.position !== null && transform.position !== "") ||
		(transform.background !== undefined && transform.background !== null && transform.background !== "")
	) {
		return undefined;
	}
	const hash16 = imageVersionPattern.test(requestContext.hash16 ?? "")
		? requestContext.hash16
		: contentHashVersion(await computeContentHash(inputBuffer));
	if (!hash16) return undefined;
	return {
		path: imageVariantCachePath(cacheDirectory, requestContext.mediaId, hash16, transform.width, transform.format, imageConfig),
		format: transform.format,
	};
}

async function getSourceWidth(inputBuffer, knownWidth) {
	if (Number.isSafeInteger(knownWidth) && knownWidth > 0) return knownWidth;
	try {
		const metadata = await sharp(inputBuffer).metadata();
		return metadata.autoOrient?.width ?? (
			metadata.orientation >= 5 && metadata.orientation <= 8
				? metadata.height
				: metadata.width
		);
	} catch {
		throw new Error("Image variant not found");
	}
}

function mediaSource(source, imageConfig) {
	if (typeof source !== "string" || !source) return undefined;

	let parsed;
	try {
		parsed = new URL(source, "http://localhost");
	} catch {
		return undefined;
	}
	if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password || parsed.search || parsed.hash) {
		return undefined;
	}

	return mediaFileSource(parsed.pathname, serviceConfig(imageConfig).deniedStorageKeyPrefixes);
}

function mediaFileSource(pathname, deniedStorageKeyPrefixes) {
	for (const candidate of decodedPathLayers(pathname)) {
		const match = /^\/_emdash\/api\/media\/file\/(.+)$/i.exec(candidate);
		if (!match) continue;

		const keyLayers = decodedPathLayers(match[1]);
		if (keyLayers.some((key) => isDeniedStorageKey(key, deniedStorageKeyPrefixes))) return { kind: "private" };

		const storageKey = keyLayers.at(-1);
		if (!storageKey) return undefined;
		const segments = storageKey.split("/");
		if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return undefined;
		return { kind: "public", key: storageKey };
	}
	return undefined;
}

function isDeniedStorageKey(key, deniedStorageKeyPrefixes = []) {
	const normalizedKey = normalizeStorageKeyForGuard(key);
	if (normalizedKey === null || !Array.isArray(deniedStorageKeyPrefixes)) return false;
	return deniedStorageKeyPrefixes.some((prefix) => {
		const normalizedPrefix = normalizeStorageKeyPrefix(prefix);
		return normalizedPrefix !== null && (
			normalizedKey === normalizedPrefix || normalizedKey.startsWith(`${normalizedPrefix}/`)
		);
	});
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

function decodedPathLayers(value) {
	const paths = [value];
	let current = value;
	for (let attempt = 0; attempt < 4; attempt++) {
		let decoded;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			break;
		}
		if (decoded === current) break;
		paths.push(decoded);
		current = decoded;
	}
	return paths;
}

async function readCachedVariant(cachePath) {
	try {
		return await readFile(cachePath);
	} catch {
		return undefined;
	}
}

async function openCachedVariant(cachePath) {
	let fileHandle;
	try {
		fileHandle = await open(cachePath, "r");
		const { size } = await fileHandle.stat();
		return {
			byteLength: size,
			createReadStream: () => fileHandle.readableWebStream({ autoClose: true }),
			async close() {
				await fileHandle.close().catch(() => undefined);
			},
		};
	} catch {
		await fileHandle?.close().catch(() => undefined);
		return undefined;
	}
}

async function writeCachedVariant(cachePath, data) {
	const directory = path.dirname(cachePath);
	await mkdir(directory, { recursive: true });
	const temporaryPath = path.join(directory, `.${path.basename(cachePath)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, data, { flag: "wx", mode: 0o600 });
		await rename(temporaryPath, cachePath);
	} finally {
		await unlink(temporaryPath).catch(() => undefined);
	}
}

export default createImageService();
