import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withImageGuard } from "../src/index.mjs";
import imageService from "../src/service.mjs";
import {
	createImageService,
	PUBLIC_IMAGE_ENCODER_CONFIG,
	PUBLIC_IMAGE_SMALL_WIDTHS,
	PUBLIC_IMAGE_WIDTHS,
	runWithImageCacheContext,
} from "../src/service.mjs";

function serviceWithEncoder(encode) {
	return {
		parseURL(url) {
			return {
				src: url.searchParams.get("href"),
				width: Number.parseInt(url.searchParams.get("w") ?? "", 10),
				height: Number.parseInt(url.searchParams.get("h") ?? "", 10) || undefined,
				format: url.searchParams.get("f") ?? undefined,
				fit: url.searchParams.get("fit") ?? undefined,
			};
		},
		async transform(inputBuffer, transform) {
			return encode(inputBuffer, transform);
		},
	};
}

async function withCacheDirectory(callback) {
	const cacheDirectory = await mkdtemp(join(tmpdir(), "image-service-cache-"));
	try {
		await callback(cacheDirectory);
	} finally {
		await rm(cacheDirectory, { recursive: true, force: true });
	}
}

async function settings8ForCache(cacheDirectory) {
	const files = await readdir(cacheDirectory, { recursive: true });
	const namespace = files.map((file) => String(file).split("/")[0]).find((entry) => /^v2-[0-9a-f]{8}$/.test(entry));
	return namespace?.slice("v2-".length);
}

const publicImageTransform = {
	src: "https://site.test/_emdash/api/media/file/work/photo.png",
	width: 640,
	format: "webp",
	fit: "cover",
};

const PRIVATE_IMAGE_WIDTHS = [640, 960, 1600, 1920, 2560];

function imageConfig() {
	return {
		service: {
			config: {
				...PUBLIC_IMAGE_ENCODER_CONFIG,
				publicWidths: PUBLIC_IMAGE_WIDTHS,
				smallWidths: PUBLIC_IMAGE_SMALL_WIDTHS,
				privateWidths: PRIVATE_IMAGE_WIDTHS,
				deniedStorageKeyPrefixes: ["private-cases/"],
			},
		},
	};
}

function imageRequestUrl(transform) {
	const url = new URL("https://site.test/_image");
	url.searchParams.set("href", transform.src);
	url.searchParams.set("w", String(transform.width));
	url.searchParams.set("f", transform.format);
	if (transform.fit) url.searchParams.set("fit", transform.fit);
	return url.href;
}

async function requestImageVariant(service, inputBuffer, url, { config = imageConfig(), cacheContext = {} } = {}) {
	const transform = await service.parseURL(new URL(url), config, {});
	if (!transform) throw new Error(`the image request was rejected: ${url}`);
	const runTransform = () => service.transform(inputBuffer, transform, config, {});
	return runWithImageCacheContext({
		mediaId: "01TESTMEDIA",
		hash16: undefined,
		originalWidth: transform.width < 640 && ![320, 480].includes(transform.width) ? transform.width : transform.width + 1,
		...cacheContext,
	}, runTransform);
}

function createImageMiddlewareHarness({
	service,
	row,
	inputBuffer = Buffer.from("original image"),
	sourceKey = "photo.png",
	config = imageConfig(),
	getMediaDatabase = (emdash) => emdash?.db,
}) {
	const stats = { lookups: [], nextCalls: 0, storageDownloads: 0, transformCalls: 0 };
	let databaseRow = row;
	let queryError = false;
	const db = {
		selectFrom(table) {
			assert.equal(table, "media");
			const selected = [];
			let storageKey;
			const builder = {
				select(columns) { selected.push(...columns); return builder; },
				where(column, operator, value) {
					assert.equal(column, "storage_key");
					assert.equal(operator, "=");
					storageKey = value;
					return builder;
				},
				async executeTakeFirst() {
					stats.lookups.push({ storageKey, selected: [...selected] });
					if (queryError) throw new Error("Synthetic media query failure");
					return databaseRow?.storage_key === storageKey ? databaseRow : undefined;
				},
			};
			return builder;
		},
	};
	const storage = {
		async download(storageKey) {
			stats.storageDownloads++;
			if (databaseRow?.storage_key !== storageKey || databaseRow.status !== "ready") {
				throw new Error("Media not found");
			}
			return { body: inputBuffer, size: inputBuffer.byteLength };
		},
	};
	const privateNotFound = () => new Response(null, {
		status: 404,
		headers: {
			"X-Robots-Tag": "noindex, nofollow",
			"Cache-Control": "private, no-store",
			"Referrer-Policy": "no-referrer",
		},
	});
	const request = async ({ mutateUrl, ifNoneMatch, requestedKey = sourceKey, method = "GET", nextResponse } = {}) => {
		const url = new URL("https://site.test/_image");
		url.searchParams.set("href", `https://site.test/_emdash/api/media/file/${requestedKey}`);
		url.searchParams.set("w", "640");
		url.searchParams.set("f", "webp");
		url.searchParams.set("fit", "cover");
		if (typeof row?.content_hash === "string") {
			url.searchParams.set("v", row.content_hash.slice("sha1:".length, "sha1:".length + 16));
		}
		mutateUrl?.(url);
		const headers = ifNoneMatch ? { "If-None-Match": ifNoneMatch } : undefined;
		const request = new Request(url, { method, headers });
		const middleware = withImageGuard(async (_context, next) => next(), {
			imageService: service,
			imageConfig: config,
			getMediaDatabase,
			deniedStorageKeyPrefixes: config.service.config.deniedStorageKeyPrefixes,
			onDeniedStorageKey: privateNotFound,
		});
		const response = await middleware({ url, request, locals: { emdash: { db, storage } } }, async () => {
			stats.nextCalls++;
			if (nextResponse) return typeof nextResponse === "function" ? nextResponse() : nextResponse;
			try {
				const source = await storage.download(requestedKey);
				const transform = await service.parseURL(url, config, {});
				stats.transformCalls++;
				const result = await service.transform(source.body, transform, config, {});
				return new Response(result.data, {
					status: 200,
					headers: {
						"Cache-Control": "public, max-age=0, must-revalidate",
						"Content-Type": `image/${result.format}`,
						ETag: 'W/"emdash-weak"',
					},
				});
			} catch {
				return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=0, must-revalidate" } });
			}
		});
		return response;
	};
	return { request, stats, setRow(value) { databaseRow = value; }, setQueryError(value) { queryError = value; } };
}

test("the image guard passes non-image requests to onRequest unchanged", async () => {
	const url = new URL("https://site.test/about");
	const request = new Request(url);
	const expected = new Response("site response", { status: 201 });
	const seen = [];
	const middleware = withImageGuard(async (context, next) => {
		seen.push(context.url.pathname);
		return next();
	});
	let nextCalls = 0;
	const response = await middleware({ url, request, locals: {} }, async () => {
		nextCalls++;
		return expected;
	});

	assert.strictEqual(response, expected);
	assert.deepEqual(seen, ["/about"]);
	assert.equal(nextCalls, 1);
});

test("a public request turns a persistent format mismatch into a no-store 500", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const service = createImageService(serviceWithEncoder(async () => ({
			data: Buffer.from("png fallback"),
			format: "png",
		})), { cacheDirectory });
		const harness = createImageMiddlewareHarness({
			service,
			row: {
				id: "01MEDIAID",
				status: "ready",
				storage_key: "photo.png",
				content_hash: "sha1:0123456789abcdef0123456789abcdef01234567",
				width: 1280,
			},
		});
		const errors = [];
		const warnings = [];
		const originalError = console.error;
		const originalWarn = console.warn;
		console.error = (...args) => errors.push(args);
		console.warn = (...args) => warnings.push(args);
		let response;
		try {
			response = await harness.request({
				mutateUrl: (url) => url.searchParams.set("f", "avif"),
				nextResponse: async () => {
					await requestImageVariant(
						service,
						Buffer.from("original image"),
						imageRequestUrl({ ...publicImageTransform, format: "avif" }),
					);
					return new Response("unexpected image response");
				},
			});
		} finally {
			console.error = originalError;
			console.warn = originalWarn;
		}

		assert.equal(response.status, 500);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(response.headers.has("cloudflare-cdn-cache-control"), false);
		assert.equal(errors.length, 1);
		assert.equal(errors[0][0], "[image] Failed to serve public image request:");
		assert.equal(warnings.length, 1);
		assert.match(warnings[0][0], /requested=avif.*returned=png/);
	});
});

test("the outer middleware serves a v2 hit without another download or encode", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const contentHash = "sha1:0123456789abcdef0123456789abcdef01234567";
		const row = { id: "01MEDIAID", status: "ready", storage_key: "photo.png", content_hash: contentHash, width: 1280 };
		const encodedBytes = Buffer.from("encoded image bytes");
		let encoderCalls = 0;
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			encoderCalls++;
			return { data: encodedBytes, format: transform.format };
		}), { cacheDirectory });
		const harness = createImageMiddlewareHarness({ service, row });

		const initial = await harness.request();
		assert.equal(initial.status, 200);
		assert.equal(harness.stats.storageDownloads, 1);
		assert.equal(encoderCalls, 1);
		const expectedEtag = `"0123456789abcdef-${await settings8ForCache(cacheDirectory)}-640-webp"`;
		assert.equal(initial.headers.get("etag"), expectedEtag,
			"a cache miss replaces EmDash's weak ETag with the same strong settings-aware tag used by hits");
		assert.equal(initial.headers.get("cache-control"), "public, max-age=31536000, immutable");
		assert.equal(initial.headers.get("cloudflare-cdn-cache-control"), "public, max-age=86400");

		const cached = await harness.request();
		assert.equal(cached.status, 200);
		assert.deepEqual(Buffer.from(await cached.arrayBuffer()), encodedBytes);
		assert.equal(cached.headers.get("content-type"), "image/webp");
		assert.equal(cached.headers.get("content-length"), String(encodedBytes.byteLength));
		assert.equal(cached.headers.get("x-content-type-options"), "nosniff");
		assert.equal(cached.headers.get("x-image-cache"), "HIT");
		assert.equal(cached.headers.get("etag"), expectedEtag,
			"the fast path includes the cache settings in its strong content-version ETag");
		assert.equal(cached.headers.get("cache-control"), "public, max-age=31536000, immutable");
		assert.equal(cached.headers.get("cloudflare-cdn-cache-control"), "public, max-age=86400");
		assert.equal(harness.stats.nextCalls, 1, "the repeated request bypasses EmDash");
		assert.equal(harness.stats.storageDownloads, 1, "the repeated request does not download the original");
		assert.equal(encoderCalls, 1, "the repeated request does not call the encoder");
		assert.equal(harness.stats.lookups.length, 2, "each valid request performs exactly one row lookup");
		assert.deepEqual(harness.stats.lookups[0].selected, ["id", "status", "content_hash", "width", "storage_key"]);

		const conditional = await harness.request({ ifNoneMatch: cached.headers.get("etag") });
		assert.equal(conditional.status, 304);
		assert.equal(conditional.headers.get("etag"), cached.headers.get("etag"));
		assert.equal(conditional.headers.get("cache-control"), "public, max-age=31536000, immutable");
		assert.equal(harness.stats.nextCalls, 1);
		assert.equal(harness.stats.storageDownloads, 1);
		assert.equal(encoderCalls, 1);

		const staleVersion = await harness.request({ mutateUrl: (url) => url.searchParams.set("v", "0000000000000000") });
		assert.equal(staleVersion.status, 302);
		assert.equal(staleVersion.headers.get("location"), "/_image?href=https%3A%2F%2Fsite.test%2F_emdash%2Fapi%2Fmedia%2Ffile%2Fphoto.png&w=640&f=webp&fit=cover&v=0123456789abcdef");
		assert.equal(staleVersion.headers.get("cache-control"), "no-store");
		assert.equal(staleVersion.headers.has("cloudflare-cdn-cache-control"), false);
		const unversioned = await harness.request({ mutateUrl: (url) => url.searchParams.delete("v") });
		assert.equal(unversioned.status, 200);
		assert.equal(unversioned.headers.get("cache-control"), "public, max-age=0, must-revalidate");
		assert.equal(unversioned.headers.has("cloudflare-cdn-cache-control"), false);
		assert.equal(harness.stats.nextCalls, 1);
		assert.equal(harness.stats.storageDownloads, 1);
		assert.equal(encoderCalls, 1);
		assert.equal(harness.stats.lookups.length, 5, "each valid request, including unversioned and stale versions, performs one lookup");
	});
});

test("only GET and HEAD requests use the v2 fast path, and HEAD has no body", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const contentHash = "sha1:0123456789abcdef0123456789abcdef01234567";
		const encodedBytes = Buffer.from("encoded image bytes");
		let encoderCalls = 0;
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			encoderCalls++;
			return { data: encodedBytes, format: transform.format };
		}), { cacheDirectory });
		const harness = createImageMiddlewareHarness({
			service,
			row: { id: "01MEDIAID", status: "ready", storage_key: "photo.png", content_hash: contentHash, width: 1280 },
		});

		const initial = await harness.request();
		assert.equal(initial.status, 200);
		const head = await harness.request({ method: "HEAD" });
		assert.equal(head.status, 200);
		assert.equal(head.headers.get("x-image-cache"), "HIT");
		assert.equal(head.headers.get("content-length"), String(encodedBytes.byteLength));
		assert.equal((await head.arrayBuffer()).byteLength, 0, "a HEAD cache hit has no response body");
		assert.equal(harness.stats.nextCalls, 1, "HEAD serves an existing cache entry directly");
		assert.equal(harness.stats.storageDownloads, 1);
		assert.equal(encoderCalls, 1);

		const post = await harness.request({ method: "POST" });
		assert.equal(post.status, 405);
		assert.equal(post.headers.get("allow"), "GET, HEAD");
		assert.equal(post.headers.get("cache-control"), "no-store");
		assert.equal(post.headers.get("x-image-cache"), null);
		assert.equal(harness.stats.nextCalls, 1, "POST is answered by the middleware");
		assert.equal(harness.stats.storageDownloads, 1);
		assert.equal(encoderCalls, 1);

		const privatePost = await harness.request({ method: "POST", requestedKey: "private-cases/case/photo.png" });
		assert.equal(privatePost.status, 404, "private image hrefs are denied before checking the method");
		assert.equal(privatePost.headers.get("cache-control"), "private, no-store");
		assert.equal(privatePost.headers.get("x-robots-tag"), "noindex, nofollow");
		assert.equal(privatePost.headers.get("referrer-policy"), "no-referrer");
		assert.equal(harness.stats.nextCalls, 1, "a private image href never reaches EmDash");
	});
});

test("missing databases and media query failures return retryable 503s without fetching or encoding", async () => {
	let encoderCalls = 0;
	const service = createImageService(serviceWithEncoder(async (_input, transform) => {
		encoderCalls++;
		return { data: Buffer.from("encoded"), format: transform.format };
	}));
	const row = { id: "01MEDIAID", status: "ready", storage_key: "photo.png", width: 1280 };
	const missingDatabase = createImageMiddlewareHarness({ service, row, getMediaDatabase: async () => undefined });
	const missingResponse = await missingDatabase.request();
	assert.equal(missingResponse.status, 503);
	assert.equal(missingResponse.headers.get("cache-control"), "no-store");
	assert.equal(missingResponse.headers.get("retry-after"), "5");
	assert.equal(missingDatabase.stats.nextCalls, 0);
	assert.equal(missingDatabase.stats.storageDownloads, 0);
	assert.equal(missingDatabase.stats.transformCalls, 0);

	const queryFailure = createImageMiddlewareHarness({ service, row });
	queryFailure.setQueryError(true);
	const queryResponse = await queryFailure.request();
	assert.equal(queryResponse.status, 503);
	assert.equal(queryResponse.headers.get("cache-control"), "no-store");
	assert.equal(queryResponse.headers.get("retry-after"), "5");
	assert.equal(queryFailure.stats.nextCalls, 0);
	assert.equal(queryFailure.stats.storageDownloads, 0);
	assert.equal(queryFailure.stats.transformCalls, 0);
	assert.equal(encoderCalls, 0);
});

test("a version parameter stays unversioned when the row has no content hash", async () => {
	const service = createImageService(serviceWithEncoder(async (_input, transform) => ({
		data: Buffer.from("encoded"),
		format: transform.format,
	})));
	const harness = createImageMiddlewareHarness({
		service,
		row: { id: "01MEDIAID", status: "ready", storage_key: "photo.png", width: 1280 },
	});
	const response = await harness.request({ mutateUrl: (url) => url.searchParams.set("v", "0000000000000000") });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
	assert.equal(response.headers.has("cloudflare-cdn-cache-control"), false);
	assert.equal(response.headers.get("x-image-cache"), null);
	assert.equal(harness.stats.nextCalls, 1);
	assert.equal(harness.stats.storageDownloads, 1);
});

test("non-ready media rows return the standard no-store 404 before calling EmDash", async () => {
	const service = createImageService(serviceWithEncoder(async (_input, transform) => ({
		data: Buffer.from("encoded"),
		format: transform.format,
	})));
	const harness = createImageMiddlewareHarness({
		service,
		row: { id: "01MEDIAID", status: "processing", storage_key: "photo.png", content_hash: "sha1:0123456789abcdef0123456789abcdef01234567", width: 1280 },
	});
	const response = await harness.request();
	assert.equal(response.status, 404);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(harness.stats.nextCalls, 0);
	assert.equal(harness.stats.storageDownloads, 0);
	assert.equal(harness.stats.transformCalls, 0);
});

test("non-2xx image responses discard CDN caching and use no-store", async () => {
	const service = createImageService(serviceWithEncoder(async (_input, transform) => ({
		data: Buffer.from("encoded"),
		format: transform.format,
	})));
	const row = { id: "01MEDIAID", status: "ready", storage_key: "photo.png", width: 1280 };
	for (const status of [302, 404, 500]) {
		const harness = createImageMiddlewareHarness({ service, row });
		const response = await harness.request({
			nextResponse: () => new Response("error", {
				status,
				headers: {
					"Cache-Control": "public, max-age=31536000, immutable",
					"Cloudflare-CDN-Cache-Control": "public, max-age=86400",
				},
			}),
		});
		assert.equal(response.status, status);
		assert.equal(response.headers.get("cache-control"), "no-store", `status ${status}`);
		assert.equal(response.headers.has("cloudflare-cdn-cache-control"), false, `status ${status}`);
	}

	const failedTransform = createImageMiddlewareHarness({ service, row });
	const errors = [];
	const originalError = console.error;
	console.error = (...args) => errors.push(args);
	let failureResponse;
	try {
		failureResponse = await failedTransform.request({
			nextResponse: () => { throw new Error("Synthetic transform failure"); },
		});
	} finally {
		console.error = originalError;
	}
	assert.equal(failureResponse.status, 500);
	assert.equal(failureResponse.headers.get("cache-control"), "no-store");
	assert.equal(failureResponse.headers.has("cloudflare-cdn-cache-control"), false);
	assert.equal(errors.length, 1, "a failed image transform is logged once");
	assert.equal(errors[0][0], "[image] Failed to serve public image request:");
	assert.equal(errors[0][1]?.message, "Synthetic transform failure");
});

test("a changed content hash does not serve the old v2 variant", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const previousHash = "sha1:0123456789abcdef0123456789abcdef01234567";
		const nextHash = "sha1:fedcba9876543210abcdef0123456789abcdef01";
		const row = { id: "01MEDIAID", status: "ready", storage_key: "photo.png", content_hash: previousHash, width: 1280 };
		let encoderCalls = 0;
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			encoderCalls++;
			return { data: Buffer.from(`encoded-${encoderCalls}`), format: transform.format };
		}), { cacheDirectory });
		const harness = createImageMiddlewareHarness({ service, row });

		const oldVersion = await harness.request();
		assert.equal(oldVersion.status, 200);
		assert.equal(Buffer.from(await oldVersion.arrayBuffer()).toString(), "encoded-1");
		const settings8 = await settings8ForCache(cacheDirectory);
		assert.equal((await harness.request()).headers.get("x-image-cache"), "HIT");

		harness.setRow({ ...row, content_hash: nextHash });
		const replacedVersion = await harness.request();
		assert.equal(replacedVersion.status, 302, "the old URL redirects instead of serving an outdated version");
		assert.equal(replacedVersion.headers.get("cache-control"), "no-store");
		const currentVersion = await harness.request({ mutateUrl: (url) => url.searchParams.set("v", "fedcba9876543210") });
		assert.equal(currentVersion.status, 200);
		assert.equal(currentVersion.headers.get("x-image-cache"), null,
			"the current content hash misses the previous v2 path instead of serving its bytes");
		assert.equal(currentVersion.headers.get("etag"), `"fedcba9876543210-${settings8}-640-webp"`);
		assert.equal(Buffer.from(await currentVersion.arrayBuffer()).toString(), "encoded-2");
		assert.equal(harness.stats.storageDownloads, 2);
		assert.equal(encoderCalls, 2);
	});
});

test("invalid public image requests return no-store 404s before downloads or cache writes", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let encoderCalls = 0;
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			encoderCalls++;
			return { data: Buffer.from("encoded"), format: transform.format };
		}), { cacheDirectory });
		const row = {
			id: "01MEDIAID",
			status: "ready",
			storage_key: "photo.png",
			content_hash: "sha1:0123456789abcdef0123456789abcdef01234567",
			width: 1280,
		};
		const invalidRequests = [
			["width 1601", (url) => url.searchParams.set("w", "1601"), 0],
			["width 777", (url) => url.searchParams.set("w", "777"), 0],
			["PNG format", (url) => url.searchParams.set("f", "png"), 0],
			["quality option", (url) => url.searchParams.set("q", "100"), 0],
			["height option", (url) => url.searchParams.set("h", "10"), 0],
			["position option", (url) => url.searchParams.set("position", "center"), 0],
			["background option", (url) => url.searchParams.set("background", "white"), 0],
			["repeated width", (url) => url.searchParams.append("w", "640"), 0],
			["repeated format", (url) => url.searchParams.append("f", "avif"), 0],
			["malformed version", (url) => url.searchParams.set("v", "bad"), 0],
			["repeated version", (url) => url.searchParams.append("v", "0123456789abcdef"), 0],
			["private storage key", (url) => url.searchParams.set("href", "https://site.test/_emdash/api/media/file/private-cases/case/photo.png"), 0],
			["foreign href", (url) => url.searchParams.set("href", "https://elsewhere.test/_emdash/api/media/file/photo.png"), 0],
			["credentialed href", (url) => url.searchParams.set("href", "https://user:pass@site.test/_emdash/api/media/file/photo.png"), 0],
			["width larger than the source row", (url) => url.searchParams.set("w", "1600"), 1],
		];

		for (const [label, mutateUrl, expectedLookups] of invalidRequests) {
			const harness = createImageMiddlewareHarness({ service, row });
			const response = await harness.request({ mutateUrl });
			assert.equal(response.status, 404, label);
			if (label === "private storage key") {
				assert.equal(response.headers.get("cache-control"), "private, no-store", label);
				assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", label);
				assert.equal(response.headers.get("referrer-policy"), "no-referrer", label);
			} else {
				assert.equal(response.headers.get("cache-control"), "no-store", label);
			}
			assert.equal(harness.stats.lookups.length, expectedLookups, `${label}: parse failures stop before the row query`);
			assert.equal(harness.stats.nextCalls, 0, `${label}: EmDash is not called`);
			assert.equal(harness.stats.storageDownloads, 0, `${label}: the original is not downloaded`);
		}
		assert.equal(encoderCalls, 0);
		assert.deepEqual(await readdir(cacheDirectory, { recursive: true }).catch(() => []), [],
			"invalid requests write no cache directory or file");
	});
});

test("deleted and newly private media are never served from an existing disk entry", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const contentHash = "sha1:0123456789abcdef0123456789abcdef01234567";
		const publicRow = { id: "01MEDIAID", status: "ready", storage_key: "photo.png", content_hash: contentHash, width: 1280 };
		const service = createImageService(serviceWithEncoder(async (_input, transform) => ({
			data: Buffer.from("cached public image"),
			format: transform.format,
		})), { cacheDirectory });
		const harness = createImageMiddlewareHarness({ service, row: publicRow });
		const initial = await harness.request();
		assert.equal(initial.status, 200);
		const originalGetCachedVariant = service.getCachedVariant;
		let cacheReads = 0;
		service.getCachedVariant = async (...args) => {
			cacheReads++;
			return originalGetCachedVariant?.(...args);
		};

		const cached = await harness.request();
		assert.equal(cached.headers.get("x-image-cache"), "HIT");
		assert.equal(cacheReads, 1);

		harness.setRow(null);
		const deleted = await harness.request();
		assert.equal(deleted.status, 404);
		assert.equal(deleted.headers.get("cache-control"), "no-store");
		assert.equal(deleted.headers.get("x-image-cache"), null);
		assert.equal(cacheReads, 1, "a missing row cannot reach its stale on-disk entry");
		assert.equal(harness.stats.nextCalls, 1, "a missing row cannot fall through to EmDash");

		harness.setRow({ ...publicRow, storage_key: "private-cases/case/photo.png" });
		const movedOldUrl = await harness.request();
		assert.equal(movedOldUrl.status, 404);
		assert.equal(movedOldUrl.headers.get("cache-control"), "no-store");
		assert.equal(movedOldUrl.headers.get("x-image-cache"), null);
		assert.equal(cacheReads, 1, "the old public URL cannot resolve to a newly private row");

		const privateHref = await harness.request({ requestedKey: "private-cases/case/photo.png" });
		assert.equal(privateHref.status, 404);
		assert.equal(privateHref.headers.get("cache-control"), "private, no-store");
		assert.equal(privateHref.headers.get("x-robots-tag"), "noindex, nofollow");
		assert.equal(privateHref.headers.get("referrer-policy"), "no-referrer");
		assert.equal(cacheReads, 1, "a private key never reads the public disk cache");
	});
});

test("streams cache hits with their file size and treats a missing cache file as a miss", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const encodedBytes = Buffer.alloc(1024 * 1024, 0x5a);
		let encoderCalls = 0;
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			encoderCalls++;
			return { data: encodedBytes, format: transform.format };
		}), { cacheDirectory });
		const harness = createImageMiddlewareHarness({
			service,
			row: {
				id: "01MEDIAID",
				status: "ready",
				storage_key: "photo.png",
				content_hash: "sha1:0123456789abcdef0123456789abcdef01234567",
				width: 1280,
			},
		});
		const initial = await harness.request();
		assert.equal(initial.status, 200);
		await initial.arrayBuffer();

		const hit = await harness.request();
		assert.equal(hit.status, 200);
		assert.equal(hit.headers.get("x-image-cache"), "HIT");
		assert.equal(hit.headers.get("content-length"), String(encodedBytes.byteLength));
		const reader = hit.body.getReader();
		const firstChunk = await reader.read();
		assert.equal(firstChunk.done, false);
		assert.ok(firstChunk.value.byteLength < encodedBytes.byteLength,
			"the cache hit yields a file-stream chunk instead of one fully buffered response");
		await reader.cancel();

		const cacheEntries = await readdir(cacheDirectory, { recursive: true });
		const cachedPath = join(cacheDirectory, String(cacheEntries.find((entry) => String(entry).endsWith("-640.webp"))));
		await unlink(cachedPath);
		const missing = await harness.request();
		assert.equal(missing.status, 200, "a cache file missing at open falls through to a fresh transform");
		assert.equal(missing.headers.get("x-image-cache"), null);
		assert.equal(encoderCalls, 2);
	});
});

test("public image middleware applies immutable headers only to the current ready media version", async () => {
	const imageServiceConfig = {
		remotePatterns: [{ pathname: "/_emdash/api/media/file/**" }],
		service: { config: { avif: {}, webp: {} } },
	};
	const privateNotFound = () => new Response(null, {
		status: 404,
		headers: {
			"X-Robots-Tag": "noindex, nofollow",
			"Cache-Control": "private, no-store",
			"Referrer-Policy": "no-referrer",
		},
	});
	const currentHash = "sha1:0123456789abcdef0123456789abcdef01234567";
	const href = "https://site.test/_emdash/api/media/file/photo.png";
	const version = "0123456789abcdef";
	const run = async ({ status = 200, query = `v=${version}`, width = 640, format = "webp", quality, contentType = `image/${format}`, row = {
		id: "media-id",
		storage_key: "photo.png",
		content_hash: currentHash,
		width: 1280,
		status: "ready",
	}, sourceHref = href, path = "/_image", provideDb = true } = {}) => {
		const lookups = [];
		const parsedTransforms = [];
		const imageServiceStub = {
			async parseURL(...args) {
				parsedTransforms.push(args[0]);
				return imageService.parseURL(...args);
			},
		};
		const db = {
			selectFrom(table) {
				assert.equal(table, "media");
				const selected = [];
				let storageKey;
				const builder = {
					select(columns) { selected.push(...columns); return builder; },
					where(column, operator, value) {
						assert.equal(column, "storage_key");
						assert.equal(operator, "=");
						storageKey = value;
						return builder;
					},
					async executeTakeFirst() {
						lookups.push({ storageKey, selected });
						return row?.storage_key === storageKey ? row : undefined;
					},
				};
				return builder;
			},
		};
		const params = new URLSearchParams({ href: sourceHref, w: String(width), f: format });
		if (quality !== undefined) params.set("q", String(quality));
		for (const [name, value] of new URLSearchParams(query)) params.append(name, value);
		const url = new URL(`${path}?${params}`, "https://site.test");
		const request = new Request(url);
		let nextCalls = 0;
		const middleware = withImageGuard(async (_context, next) => next(), {
			imageService: imageServiceStub,
			imageConfig: imageServiceConfig,
			getMediaDatabase: async (emdash) => emdash?.db,
			deniedStorageKeyPrefixes: ["private-cases/"],
			onDeniedStorageKey: privateNotFound,
		});
		const response = await middleware({
			url,
			request,
			locals: { emdash: provideDb ? { db } : {} },
		}, async () => {
			nextCalls++;
			return new Response(status === 304 ? null : "image bytes", {
				status,
				headers: {
					"Cache-Control": "public, max-age=0, must-revalidate",
					"Content-Type": contentType,
				},
			});
		});
		return { response, lookups, nextCalls, parsedTransforms };
	};

	for (const status of [200, 304]) {
		const { response, lookups } = await run({ status, contentType: status === 304 ? "image/png" : "image/webp" });
		assert.equal(response.status, status);
		assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
		assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "public, max-age=86400");
		assert.equal(lookups.length, 1, "one version check uses one database lookup");
		assert.deepEqual(lookups[0].selected, ["id", "status", "content_hash", "width", "storage_key"]);
	}
	const invalid304 = await run({ status: 304, width: 999, contentType: "image/png" });
	assert.equal(invalid304.response.status, 404);
	assert.equal(invalid304.response.headers.get("cache-control"), "no-store");
	assert.equal(invalid304.response.headers.has("cloudflare-cdn-cache-control"), false);
	assert.equal(invalid304.parsedTransforms.length, 1, "an image/ 304 validates its transform before setting cache headers");

	for (const [format, contentType] of [["avif", "image/avif"], ["webp", "image/webp"]]) {
		const { response } = await run({ format, contentType });
		assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
		assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "public, max-age=86400");
	}

	for (const [label, options] of [
		["unsupported transform options", { width: 999, format: "png", quality: 10 }],
		["source href query", { sourceHref: `${href}?x=1` }],
		["source href fragment", { sourceHref: `${href}#x` }],
		["PNG fallback response", { contentType: "image/png" }],
	]) {
		const { response, lookups } = await run(options);
		assert.equal(response.headers.get("cache-control"), options.contentType ? "public, max-age=0, must-revalidate" : "no-store", label);
		assert.equal(response.headers.has("cloudflare-cdn-cache-control"), false, label);
		assert.equal(lookups.length, options.contentType ? 1 : 0, `${label} uses the row lookup only for a validated request`);
	}

	const stale = await run({ row: { id: "media-id", storage_key: "photo.png", content_hash: "sha1:fedcba9876543210abcdef0123456789abcdef01", width: 1280, status: "ready" } });
	assert.equal(stale.response.status, 302);
	assert.equal(stale.response.headers.get("location"), "/_image?href=https%3A%2F%2Fsite.test%2F_emdash%2Fapi%2Fmedia%2Ffile%2Fphoto.png&w=640&f=webp&v=fedcba9876543210");
	assert.equal(stale.response.headers.get("cache-control"), "no-store");
	assert.equal(stale.lookups.length, 1);
	assert.equal(stale.nextCalls, 0);

	for (const query of ["v=0123456789abcdeZ", `v=${version}&v=${version}`]) {
		const malformed = await run({ query });
		assert.equal(malformed.response.status, 404);
		assert.equal(malformed.response.headers.get("cache-control"), "no-store");
		assert.equal(malformed.lookups.length, 0);
		assert.equal(malformed.nextCalls, 0);
	}

	const missing = await run({ row: null });
	assert.equal(missing.response.status, 404);
	assert.equal(missing.response.headers.get("cache-control"), "no-store");
	assert.equal(missing.lookups.length, 1);
	assert.equal(missing.nextCalls, 0);

	const unversioned = await run({ query: "" });
	assert.equal(unversioned.response.status, 200);
	assert.equal(unversioned.response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
	assert.equal(unversioned.response.headers.has("cloudflare-cdn-cache-control"), false);
	assert.equal(unversioned.lookups.length, 1);

	const pending = await run({ row: { storage_key: "photo.png", content_hash: currentHash, status: "pending" } });
	assert.equal(pending.response.status, 404);
	assert.equal(pending.response.headers.get("cache-control"), "no-store");
	assert.equal(pending.nextCalls, 0);
	const previousError = console.error;
	const errors = [];
	console.error = (...args) => errors.push(args);
	try {
		const unavailableDatabase = await run({ provideDb: false });
		assert.equal(unavailableDatabase.response.status, 503);
		assert.equal(unavailableDatabase.response.headers.get("cache-control"), "no-store");
		assert.equal(unavailableDatabase.response.headers.get("retry-after"), "5");
		assert.equal(unavailableDatabase.response.headers.has("cloudflare-cdn-cache-control"), false);
		assert.equal(unavailableDatabase.lookups.length, 0);
		assert.equal(unavailableDatabase.nextCalls, 0);
		assert.deepEqual(errors, [], "an unavailable image-request database does not log per request");
	} finally {
		console.error = previousError;
	}

	const privateCase = await run({
		sourceHref: "https://site.test/_emdash/api/media/file/private-cases/case/image.png",
	});
	assert.equal(privateCase.response.status, 404);
	assert.equal(privateCase.response.headers.get("cache-control"), "private, no-store");
	assert.equal(privateCase.response.headers.get("x-robots-tag"), "noindex, nofollow");
	assert.equal(privateCase.response.headers.get("referrer-policy"), "no-referrer");
	assert.equal(privateCase.lookups.length, 0);
	assert.equal(privateCase.nextCalls, 0, "a private-cases key is refused before EmDash can answer it");

	for (const sourceHref of [
		"https://site.test/_emdash/api/media/file/%30photo.png",
		"https://site.test/_EMDASH/api/media/file/photo.png",
		"https://site.test/_emdash/api/media/file/work/photo.png",
		"https://elsewhere.test/_emdash/api/media/file/photo.png",
		"https://elsewhere.test/_emdash/api/media/file/%30photo.png",
	]) {
		const invalid = await run({ sourceHref });
		assert.equal(invalid.response.status, 404, `invalid public source must be refused: ${sourceHref}`);
		assert.equal(invalid.response.headers.get("cache-control"), "no-store");
		assert.equal(invalid.response.headers.has("cloudflare-cdn-cache-control"), false);
		assert.equal(invalid.lookups.length, 0, "invalid hrefs do not query media rows");
		assert.equal(invalid.nextCalls, 0, "invalid hrefs are refused before EmDash or Astro run");
	}
});
