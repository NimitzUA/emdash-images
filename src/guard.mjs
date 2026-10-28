import publicImageService, { isPublicImageWidthAllowed, runWithImageCacheContext } from "./service.mjs";
import { contentHashVersion, imageCacheSettings8 } from "./layout.mjs";
import { getMediaDatabase } from "./media-database.mjs";

const PUBLIC_IMAGE_PREFIX = "/_emdash/api/media/file/";
const SAFE_PUBLIC_IMAGE_KEY = /^[A-Za-z0-9._-]+$/;
const IMAGE_VERSION_PATTERN = /^[0-9a-f]{16}$/;
const IMMUTABLE_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const CDN_IMAGE_CACHE_CONTROL = "public, max-age=86400";

export function withImageGuard(onRequest, {
	imageService = publicImageService,
	imageConfig: injectedImageConfig,
	getMediaDatabase: resolveMediaDatabase = getMediaDatabase,
	deniedStorageKeyPrefixes = [],
	onDeniedStorageKey,
} = {}) {
	if (typeof onRequest !== "function") throw new TypeError("withImageGuard requires an onRequest function.");
	const deniedPrefixes = normalizeDeniedStorageKeyPrefixes(deniedStorageKeyPrefixes);

	return async function imageGuard(context, next) {
		if (context.url.pathname.toLowerCase() !== "/_image") return onRequest(context, next);
		if (isDeniedImageRequest(context.url, deniedPrefixes)) {
			return typeof onDeniedStorageKey === "function" ? onDeniedStorageKey(context) : imageNotFound();
		}

		const imageState = await preparePublicImageRequest(context, imageService, injectedImageConfig, resolveMediaDatabase, deniedPrefixes);
		if (imageState?.response) return imageState.response;

		let response;
		try {
			response = imageState?.cacheContext
				? await runWithImageCacheContext(imageState.cacheContext, () => onRequest(context, next))
				: await onRequest(context, next);
		} catch (error) {
			console.error("[image] Failed to serve public image request:", error);
			return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
		}

		return imageState?.media
			? withImageCacheHeaders(response, context.url, imageState.media, imageState.transform, imageState.imageConfig)
			: response;
	};
}

async function preparePublicImageRequest(context, imageService, injectedImageConfig, resolveMediaDatabase, deniedPrefixes) {
	if (!["GET", "HEAD"].includes(context.request.method.toUpperCase())) {
		return { response: new Response(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } }) };
	}
	const storageKey = publicImageStorageKey(context, deniedPrefixes);
	if (!storageKey) return { response: imageNotFound() };
	let imageConfig = injectedImageConfig;
	if (!imageConfig) {
		try {
			imageConfig = (await import("astro:assets")).imageConfig;
		} catch {
			return { response: imageNotFound() };
		}
	}
	if (typeof imageService?.parseURL !== "function" || !imageConfig) return { response: imageNotFound() };
	let transform;
	try {
		transform = await imageService.parseURL(context.url, imageConfig, context.logger ?? {});
	} catch {
		return { response: imageNotFound() };
	}
	if (!transform) return { response: imageNotFound() };

	let db;
	try {
		db = await resolveMediaDatabase(context.locals.emdash);
	} catch {
		return { response: imageServiceUnavailable() };
	}
	if (!db) return { response: imageServiceUnavailable() };
	let media;
	try {
		media = await db.selectFrom("media")
			.select(["id", "status", "content_hash", "width", "storage_key"])
			.where("storage_key", "=", storageKey)
			.executeTakeFirst();
	} catch {
		return { response: imageServiceUnavailable() };
	}
	if (!media || media.status !== "ready" || media.storage_key !== storageKey || !media.id || isDeniedStorageKey(media.storage_key, deniedPrefixes)) {
		return { response: imageNotFound() };
	}
	if (!isPublicImageWidthAllowed(transform.width, media.width, imageConfig)) return { response: imageNotFound() };

	const hash16 = contentHashVersion(media.content_hash);
	const versions = context.url.searchParams.getAll("v");
	if (hash16 && versions.length === 1 && IMAGE_VERSION_PATTERN.test(versions[0]) && versions[0] !== hash16) {
		const redirectUrl = new URL(context.url);
		redirectUrl.searchParams.set("v", hash16);
		return {
			response: new Response(null, {
				status: 302,
				headers: {
					Location: `${redirectUrl.pathname}${redirectUrl.search}`,
					"Cache-Control": "no-store",
				},
			}),
		};
	}
	if (hash16 && typeof imageService.getCachedVariant === "function") {
		try {
			const cached = await imageService.getCachedVariant(media, transform, imageConfig);
			if (cached) {
				const response = await cachedImageResponse(cached, transform, hash16, context.request, imageConfig);
				return { response: withImageCacheHeaders(response, context.url, media, transform, imageConfig) };
			}
		} catch {
			// A cache read failure falls through to the normal EmDash transform.
		}
	}
	return {
		media,
		transform,
		imageConfig,
		cacheContext: { mediaId: media.id, hash16, originalWidth: media.width },
	};
}

async function cachedImageResponse(cached, transform, hash16, request, imageConfig) {
	const etag = imageVariantEtag(hash16, transform, imageConfig);
	const headers = new Headers({
		"Content-Type": `image/${transform.format}`,
		"Content-Length": String(cached.byteLength),
		"Cache-Control": "public, max-age=0, must-revalidate",
		"X-Content-Type-Options": "nosniff",
		ETag: etag,
		"X-Image-Cache": "HIT",
	});
	if (ifNoneMatchMatches(request.headers.get("If-None-Match"), etag)) {
		await cached.close();
		return new Response(null, { status: 304, headers });
	}
	if (request.method === "HEAD") {
		await cached.close();
		return new Response(null, { status: 200, headers });
	}
	try {
		return new Response(cached.createReadStream(), { status: 200, headers });
	} catch (error) {
		await cached.close();
		throw error;
	}
}

function imageVariantEtag(hash16, transform, imageConfig) {
	return `"${hash16}-${imageCacheSettings8(imageConfig)}-${transform.width}-${transform.format}"`;
}

function ifNoneMatchMatches(value, etag) {
	if (!value) return false;
	return value.split(",").some((candidate) => {
		const trimmed = candidate.trim();
		return trimmed === "*" || trimmed.replace(/^W\//i, "") === etag;
	});
}

function withImageCacheHeaders(response, url, media, transform, imageConfig) {
	if (!response) return response;
	const supportedImageResponse = [200, 304].includes(response.status);
	if (!supportedImageResponse && (response.status < 200 || response.status >= 300)) {
		const headers = new Headers(response.headers);
		headers.set("Cache-Control", "no-store");
		headers.delete("Cloudflare-CDN-Cache-Control");
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}
	if (!supportedImageResponse) return response;
	const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
	const isImageResponse = response.status === 200
		? contentType === `image/${transform?.format}`
		: contentType?.startsWith("image/");
	const hash16 = contentHashVersion(media.content_hash);
	const versions = url.searchParams.getAll("v");
	const versionMatches = versions.length === 1 && IMAGE_VERSION_PATTERN.test(versions[0]) && hash16 === versions[0];

	const headers = new Headers(response.headers);
	if (hash16 && transform && isImageResponse) headers.set("ETag", imageVariantEtag(hash16, transform, imageConfig));
	if (versionMatches && isImageResponse) {
		headers.set("Cache-Control", IMMUTABLE_IMAGE_CACHE_CONTROL);
		headers.set("Cloudflare-CDN-Cache-Control", CDN_IMAGE_CACHE_CONTROL);
	}
	if (headers.get("ETag") === response.headers.get("ETag") &&
		headers.get("Cache-Control") === response.headers.get("Cache-Control") &&
		headers.get("Cloudflare-CDN-Cache-Control") === response.headers.get("Cloudflare-CDN-Cache-Control")) {
		return response;
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function imageNotFound() {
	return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function imageServiceUnavailable() {
	return new Response(null, {
		status: 503,
		headers: { "Cache-Control": "no-store", "Retry-After": "5" },
	});
}

function publicImageStorageKey(context, deniedPrefixes) {
	const { url } = context;
	const hrefs = url.searchParams.getAll("href");
	if (hrefs.length !== 1) return undefined;

	let internalUrl;
	try {
		// Mirror EmDash matchInternalMediaKey: resolve against its dummy origin,
		// inspect pathname only, and do not decode the key again.
		internalUrl = new URL(hrefs[0], "http://localhost");
	} catch {
		return undefined;
	}
	if (!internalUrl.pathname.startsWith(PUBLIC_IMAGE_PREFIX)) return undefined;
	const storageKey = internalUrl.pathname.slice(PUBLIC_IMAGE_PREFIX.length);
	if (!SAFE_PUBLIC_IMAGE_KEY.test(storageKey) || isDeniedStorageKey(storageKey, deniedPrefixes)) return undefined;

	let source;
	try {
		source = new URL(hrefs[0], url.origin);
	} catch {
		return undefined;
	}
	if (
		!(source.protocol === "http:" || source.protocol === "https:") ||
		source.username || source.password ||
		!publicImageOrigins(context).has(source.origin)
	) return undefined;
	return storageKey;
}

function publicImageOrigins(context) {
	const origins = new Set([context.url.origin]);
	const candidates = [
		context.locals.emdash?.config?.siteUrl,
		process.env.EMDASH_SITE_URL,
		process.env.SITE_URL,
	];
	for (const value of candidates) {
		if (typeof value !== "string" || !value.trim()) continue;
		try {
			const url = new URL(value.trim());
			if (
				(url.protocol === "http:" || url.protocol === "https:") &&
				url.hostname && !url.username && !url.password
			) origins.add(url.origin);
		} catch {
			// Invalid optional site URLs do not expand the accepted origins.
		}
	}
	return origins;
}

function isDeniedImageRequest(url, deniedPrefixes) {
	if (url.pathname.toLowerCase() !== "/_image") return false;
	for (const href of url.searchParams.getAll("href")) {
		for (const candidate of decodeLayers(href)) {
			let parsed;
			try {
				parsed = new URL(candidate, url.origin);
			} catch {
				continue;
			}
			for (const path of decodeLayers(parsed.pathname)) {
				const match = /^\/_emdash\/api\/media\/file\/(.+)$/i.exec(path);
				if (!match) continue;
				for (const key of decodeLayers(match[1])) {
					if (normalizeStorageKeyForGuard(key) === null || isDeniedStorageKey(key, deniedPrefixes)) return true;
				}
			}
		}
	}
	return false;
}

function normalizeDeniedStorageKeyPrefixes(prefixes) {
	if (!Array.isArray(prefixes)) return [];
	return prefixes.map((prefix) => {
		if (typeof prefix !== "string" || !prefix.trim()) return null;
		const withoutTrailingSlashes = prefix.trim().replace(/\/+$/, "");
		return normalizeStorageKeyForGuard(withoutTrailingSlashes);
	}).filter(Boolean);
}

function isDeniedStorageKey(key, deniedPrefixes) {
	const normalized = normalizeStorageKeyForGuard(key);
	if (normalized === null) return false;
	return deniedPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function normalizeStorageKeyForGuard(key) {
	if (typeof key !== "string" || key.length === 0 || key.includes("\\")) return null;
	const segments = key.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
	return key.toLowerCase();
}

function decodeLayers(value) {
	const results = [value];
	let current = value;
	for (let attempt = 0; attempt < 4; attempt++) {
		let decoded;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			break;
		}
		if (decoded === current) break;
		results.push(decoded);
		current = decoded;
	}
	return results;
}
