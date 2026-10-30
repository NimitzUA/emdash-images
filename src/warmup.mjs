import { readdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { parseImageVariantCachePath } from "./layout.mjs";

const PAGE_CONCURRENCY = 2;
const VARIANT_CONCURRENCY = 1;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_SITEMAPS = 100;
const MEDIA_FILE_PATH_PREFIX = "/_emdash/api/media/file/";

export function extractSitemapLocations(xml) {
	const locations = [];
	for (const match of xml.matchAll(/<(?:[\w.-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?loc\s*>/gi)) {
		const value = decodeHtmlEntities(match[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "")).trim();
		if (value) locations.push(value);
	}
	return locations;
}

export function extractImageVariantUrls(html, publicOrigin, options = {}) {
	const origin = toUrl(publicOrigin);
	const urls = new Set();
	const markup = html.replace(/<!--[\s\S]*?-->/g, "");

	for (const match of markup.matchAll(/<(source|img|video)\b[^>]*>/gi)) {
		const tagName = match[1].toLowerCase();
		const attributes = readAttributes(match[0], tagName);
		const values = [];
		if ((tagName === "source" || tagName === "img") && attributes.srcset) {
			values.push(...decodeHtmlEntities(attributes.srcset).split(",").map((candidate) => candidate.trim().split(/\s+/, 1)[0]));
		}
		if (tagName === "img" && attributes.src) values.push(attributes.src);
		if (tagName === "video" && attributes.poster) values.push(attributes.poster);

		for (const value of values) {
			if (!value) continue;
			let candidate;
			try {
				candidate = new URL(value, origin);
			} catch {
				continue;
			}
			if (
				candidate.origin !== origin.origin ||
				candidate.pathname.toLowerCase() !== "/_image" ||
				isDeniedImageVariant(candidate, origin, options)
			) continue;
			urls.add(candidate.href);
		}
	}

	return [...urls];
}

export function mapSiteUrlToRequestUrl(value, publicOrigin, requestOrigin, options = {}) {
	try {
		const origin = toUrl(publicOrigin);
		const target = new URL(value, origin);
		if (
			target.origin !== origin.origin ||
			target.username ||
			target.password ||
			isDeniedPath(target.pathname, options)
		) return undefined;

		const local = new URL(`${target.pathname}${target.search}`, toUrl(requestOrigin));
		local.hash = "";
		return local;
	} catch {
		return undefined;
	}
}

function toUrl(value) {
	const url = value instanceof URL ? new URL(value.href) : new URL(value);
	if (
		!(url.protocol === "http:" || url.protocol === "https:") ||
		url.username ||
		url.password ||
		(url.pathname !== "/" && url.pathname !== "") ||
		url.search ||
		url.hash
	) throw new TypeError("Expected an HTTP(S) origin URL.");
	return new URL(url.origin);
}

function readAttributes(tag, tagName) {
	const prefix = new RegExp(`^<${tagName}\\b`, "i");
	const value = tag.replace(prefix, "").replace(/>\s*$/, "");
	const attributes = Object.create(null);
	const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
	for (const match of value.matchAll(pattern)) {
		const name = match[1].toLowerCase();
		attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
	}
	return attributes;
}

function decodeHtmlEntities(value) {
	return value.replace(/&(#(?:x[\da-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (entity, key) => {
		if (key[0] === "#") {
			const codePoint = key[1].toLowerCase() === "x"
				? Number.parseInt(key.slice(2), 16)
				: Number.parseInt(key.slice(1), 10);
			return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
				? String.fromCodePoint(codePoint)
				: entity;
		}
		return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[key.toLowerCase()] ?? entity;
	});
}

function isDeniedImageVariant(url, origin, options) {
	if (isDeniedPath(url.pathname, options)) return true;
	for (const href of url.searchParams.getAll("href")) {
		try {
			const source = new URL(href, origin);
			if (isDeniedPath(source.pathname, options)) return true;
		} catch {
			// Invalid image sources are left for the image service to reject.
		}
	}
	return false;
}

function isDeniedPath(pathname, options = {}) {
	return isDeniedPagePath(pathname, options.deniedPagePathPrefixes) ||
		isDeniedStorageFilePath(pathname, options.deniedStorageKeyPrefixes);
}

function isDeniedPagePath(pathname, deniedPagePathPrefixes = []) {
	if (!Array.isArray(deniedPagePathPrefixes)) return false;
	const pathLayers = decodedPathLayers(pathname).map((value) => value.toLowerCase());
	const deniedPrefixes = deniedPagePathPrefixes.map(normalizePagePathPrefix).filter(Boolean);
	return deniedPrefixes.some((prefix) => pathLayers.some((value) =>
		value === prefix || value.startsWith(prefix === "/" ? "/" : `${prefix}/`)
	));
}

function isDeniedStorageFilePath(pathname, deniedStorageKeyPrefixes = []) {
	if (!Array.isArray(deniedStorageKeyPrefixes)) return false;
	const deniedPrefixes = deniedStorageKeyPrefixes.map(normalizeStorageKeyPrefix).filter(Boolean);
	if (deniedPrefixes.length === 0) return false;
	const routePrefix = MEDIA_FILE_PATH_PREFIX.toLowerCase();
	for (const pathLayer of decodedPathLayers(pathname)) {
		if (!pathLayer.toLowerCase().startsWith(routePrefix)) continue;
		const encodedKey = pathLayer.slice(MEDIA_FILE_PATH_PREFIX.length);
		for (const key of decodedPathLayers(encodedKey)) {
			const normalizedKey = normalizeStorageKey(key);
			if (normalizedKey === null) return true;
			if (deniedPrefixes.some((prefix) => normalizedKey === prefix || normalizedKey.startsWith(`${prefix}/`))) return true;
		}
	}
	return false;
}

function normalizePagePathPrefix(prefix) {
	if (typeof prefix !== "string" || !prefix.trim()) return null;
	const normalized = decodedPathLayers(prefix.trim()).at(-1).toLowerCase();
	if (!normalized.startsWith("/") || normalized.includes("\\") || normalized.includes("?") || normalized.includes("#")) return null;
	return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function normalizeStorageKey(key) {
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
	const layers = [value];
	let current = value;
	for (let attempt = 0; attempt < 4; attempt++) {
		let decoded;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			break;
		}
		if (decoded === current) break;
		layers.push(decoded);
		current = decoded;
	}
	return layers;
}

export function createLocalWarmupOrigins(env = process.env) {
	const port = env.PORT || env.SITE_PORT;
	if (!/^[0-9]{1,5}$/.test(port ?? "") || Number(port) < 1 || Number(port) > 65535) {
		throw new Error("The site process must provide a valid PORT or SITE_PORT for local cache warming.");
	}
	const requestOrigin = new URL(`http://127.0.0.1:${Number(port)}`);
	let publicOrigin;
	try {
		publicOrigin = toUrl(env.EMDASH_SITE_URL || requestOrigin.href);
	} catch {
		throw new Error("EMDASH_SITE_URL must be an HTTP(S) origin without a path.");
	}
	return { requestOrigin, publicOrigin };
}

export async function warmLocalSite(env = process.env, options = {}) {
	const { requestOrigin, publicOrigin } = createLocalWarmupOrigins(env);
	return warmPublicSite(requestOrigin, publicOrigin, options);
}

async function fetchSite(requestUrl, requestOrigin, publicOrigin, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
	let current = new URL(requestUrl, publicOrigin).href;
	const visited = new Set();
	for (let redirects = 0; redirects <= 5; redirects++) {
		const localUrl = mapSiteUrlToRequestUrl(current, publicOrigin, requestOrigin, options);
		if (!localUrl) throw new Error("URL is outside the configured site origin or under a denied path.");
		if (visited.has(localUrl.href)) throw new Error("site response redirected in a loop.");
		visited.add(localUrl.href);

		const headers = { host: publicOrigin.host };
		if (publicOrigin.protocol === "https:") headers["x-forwarded-proto"] = "https";
		const response = await fetch(localUrl, {
			headers,
			redirect: "manual",
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (response.status < 300 || response.status >= 400) return response;

		const location = response.headers.get("location");
		if (!location) return response;
		let target;
		try {
			target = new URL(location, current);
		} catch {
			if (response.body) await response.body.cancel().catch(() => undefined);
			throw new Error("site response had an invalid redirect target.");
		}
		if (
			(target.origin !== publicOrigin.origin && target.origin !== requestOrigin.origin) ||
			target.username ||
			target.password ||
			isDeniedPath(target.pathname, options)
		) {
			if (response.body) await response.body.cancel().catch(() => undefined);
			throw new Error("site response redirected outside the configured site origin or under a private path.");
		}
		if (response.body) await response.body.cancel().catch(() => undefined);
		current = new URL(`${target.pathname}${target.search}`, publicOrigin).href;
	}
	throw new Error("site response exceeded the redirect limit.");
}

async function collectSitemapPages(requestOrigin, publicOrigin, failures, options = {}) {
	const sitemapQueue = [new URL("/sitemap.xml", publicOrigin).href];
	const visitedSitemaps = new Set();
	const pageLocations = new Set();
	let sitemaps = 0;

	while (sitemapQueue.length > 0 && visitedSitemaps.size < MAX_SITEMAPS) {
		const location = sitemapQueue.shift();
		const localUrl = mapSiteUrlToRequestUrl(location, publicOrigin, requestOrigin, options);
		if (!localUrl || visitedSitemaps.has(localUrl.href)) continue;
		visitedSitemaps.add(localUrl.href);
		try {
			const response = await fetchSite(location, requestOrigin, publicOrigin, options);
			const xml = await response.text();
			sitemaps++;
			if (!response.ok) {
				failures.push(`sitemap ${localUrl.pathname} returned HTTP ${response.status}`);
				continue;
			}
			const locations = extractSitemapLocations(xml);
			if (/<(?:[\w.-]+:)?sitemapindex\b/i.test(xml)) {
				for (const child of locations) {
					const childUrl = mapSiteUrlToRequestUrl(child, publicOrigin, requestOrigin, options);
					if (childUrl && !visitedSitemaps.has(childUrl.href)) sitemapQueue.push(child);
				}
			} else {
				for (const page of locations) {
					const pageUrl = mapSiteUrlToRequestUrl(page, publicOrigin, requestOrigin, options);
					if (pageUrl && !pageUrl.pathname.startsWith("/_")) {
						pageLocations.add(`${pageUrl.pathname}${pageUrl.search}`);
					}
				}
			}
		} catch (error) {
			failures.push(`sitemap ${localUrl.pathname} failed: ${errorMessage(error)}`);
		}
	}

	if (sitemapQueue.length > 0) failures.push(`sitemap discovery stopped after ${MAX_SITEMAPS} sitemap files`);
	pageLocations.add("/");
	pageLocations.add(`/__cache-warm-404-${randomUUID()}`);

	return { pageLocations: [...pageLocations], sitemaps };
}

async function mapWithConcurrency(items, concurrency, callback) {
	const results = new Array(items.length);
	let nextIndex = 0;
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await callback(items[index], index);
		}
	}));
	return results;
}

async function readCacheFiles(directory, parseImageVariantCachePath) {
	if (typeof parseImageVariantCachePath !== "function") {
		throw new TypeError("Image cache warm-up requires a cache-path parser.");
	}
	const files = new Set();
	async function visit(currentDirectory) {
		let entries;
		try {
			entries = await readdir(currentDirectory, { withFileTypes: true });
		} catch (error) {
			if (error?.code === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
			const entryPath = path.join(currentDirectory, entry.name);
			if (entry.isDirectory()) {
				await visit(entryPath);
			} else if (entry.isFile() && parseImageVariantCachePath(directory, entryPath)) {
				files.add(entryPath);
			}
		}
	}
	await visit(directory);
	return files;
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function variantLabel(value, origin) {
	try {
		const url = new URL(value, origin);
		return `${url.pathname}?w=${url.searchParams.get("w") ?? "?"}&f=${url.searchParams.get("f") ?? "?"}`;
	} catch {
		return "image variant";
	}
}

export async function warmPublicSite(requestOrigin, publicOrigin, options = {}) {
	const {
		cacheDirectory: configuredCacheDirectory = process.env.IMAGE_CACHE_DIR?.trim() || ".dev/image-cache",
		deniedStorageKeyPrefixes = [],
		deniedPagePathPrefixes = [],
	} = options;
	const deniedPaths = { deniedStorageKeyPrefixes, deniedPagePathPrefixes };
	let cacheDirectory = path.resolve(configuredCacheDirectory);
	const startedAt = performance.now();
	const failures = [];
	const discovery = await collectSitemapPages(requestOrigin, publicOrigin, failures, deniedPaths);
	const pageResults = await mapWithConcurrency(discovery.pageLocations, PAGE_CONCURRENCY, async (location) => {
		const expected404 = location.startsWith("/__cache-warm-404-");
		try {
			const response = await fetchSite(location, requestOrigin, publicOrigin, deniedPaths);
			const html = await response.text();
			const rendered = expected404 ? response.status === 404 : response.ok;
			if (!rendered) {
				failures.push(`page ${location} returned HTTP ${response.status}`);
			}
			return { location, html: rendered ? html : "", rendered };
		} catch (error) {
			failures.push(`page ${location} failed: ${errorMessage(error)}`);
			return { location, html: "", rendered: false };
		}
	});

	const variantUrls = new Set();
	for (const page of pageResults) {
		for (const variant of extractImageVariantUrls(page.html, publicOrigin, deniedPaths)) variantUrls.add(variant);
	}

	let cacheBefore;
	let cacheAfter;
	try {
		cacheBefore = await readCacheFiles(cacheDirectory, parseImageVariantCachePath);
	} catch (error) {
		failures.push(`could not inspect image cache: ${errorMessage(error)}`);
	}

	const variants = [...variantUrls];
	const variantResults = await mapWithConcurrency(variants, VARIANT_CONCURRENCY, async (variant) => {
		try {
			const response = await fetchSite(variant, requestOrigin, publicOrigin, deniedPaths);
			await response.arrayBuffer();
			if (!response.ok) {
				failures.push(`variant ${variantLabel(variant, publicOrigin)} returned HTTP ${response.status}`);
				return false;
			}
			return true;
		} catch (error) {
			failures.push(`variant ${variantLabel(variant, publicOrigin)} failed: ${errorMessage(error)}`);
			return false;
		}
	});

	try {
		cacheAfter = await readCacheFiles(cacheDirectory, parseImageVariantCachePath);
	} catch (error) {
		failures.push(`could not inspect image cache after warming: ${errorMessage(error)}`);
	}

	const successfulVariants = variantResults.filter(Boolean).length;
	let generated = 0;
	let cached = 0;
	if (cacheBefore && cacheAfter) {
		const newCacheFiles = [...cacheAfter].filter((file) => !cacheBefore.has(file)).length;
		generated = Math.min(newCacheFiles, successfulVariants);
		cached = successfulVariants - generated;
	}

	return {
		pagesRequested: pageResults.length,
		pagesRendered: pageResults.filter((page) => page.rendered).length,
		pageFailures: pageResults.filter((page) => !page.rendered).length,
		sitemaps: discovery.sitemaps,
		variants: variants.length,
		generated,
		cached,
		failedVariants: variants.length - successfulVariants,
		failures,
		elapsedMs: performance.now() - startedAt,
		cacheAccountingAvailable: Boolean(cacheBefore && cacheAfter),
	};
}

const DEFAULT_DEBOUNCE_MS = 5_000;
const schedulerKey = Symbol.for("@nimitzua/emdash-images.image-warmup-scheduler");

export function isImageWarmupEnabled(env = process.env) {
	return env.NODE_ENV === "production" || env.IMAGE_WARMUP_ON_PUBLISH === "1";
}

export function createImageWarmupScheduler({
	run,
	enabled = true,
	delayMs = DEFAULT_DEBOUNCE_MS,
	log = (message) => console.error(message),
	setTimer = setTimeout,
	clearTimer = clearTimeout,
} = {}) {
	if (typeof run !== "function") throw new TypeError("Image warm-up scheduler requires a run function.");
	let timer;
	let running = false;
	let rerunRequested = false;
	let scheduledOptions;

	const startRun = async () => {
		if (running) {
			rerunRequested = true;
			return;
		}
		running = true;
		try {
			const result = await run(scheduledOptions);
			if (Array.isArray(result?.failures) && result.failures.length > 0) {
				log(`[image-warmup] ${result.failures.join("; ")}`);
			}
		} catch (error) {
			log(`[image-warmup] ${errorMessage(error)}`);
		} finally {
			running = false;
			if (rerunRequested) {
				rerunRequested = false;
				queueRun(0);
			}
		}
	};

	const queueRun = (waitMs) => {
		timer = setTimer(() => {
			timer = undefined;
			void startRun();
		}, waitMs);
		timer?.unref?.();
	};

	return {
		schedule(options) {
			if (!enabled) return false;
			scheduledOptions = options;
			if (running) {
				rerunRequested = true;
				return true;
			}
			if (timer !== undefined) clearTimer(timer);
			queueRun(delayMs);
			return true;
		},
	};
}

const existingScheduler = globalThis[schedulerKey];
const imageWarmupScheduler = existingScheduler ?? createImageWarmupScheduler({
	enabled: isImageWarmupEnabled(),
	run: (options) => warmLocalSite(process.env, options),
});
if (!existingScheduler) globalThis[schedulerKey] = imageWarmupScheduler;

export function scheduleImageWarmup(options = {}) {
	imageWarmupScheduler.schedule(options);
}
