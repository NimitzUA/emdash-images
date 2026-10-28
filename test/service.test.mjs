import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { computeContentHash } from "emdash";
import sharp from "sharp";
import { imageService } from "../src/index.mjs";
import {
	createImageEncodeLimiter,
	createImageService,
	imageCacheSettings8,
	imageVariantCachePath,
	PUBLIC_IMAGE_ENCODER_CONFIG,
	PUBLIC_IMAGE_SMALL_WIDTHS,
	PUBLIC_IMAGE_WIDTHS,
	runWithImageCacheContext,
} from "../src/service.mjs";

function serviceWithToBuffer(toBuffer) {
	return {
		async transform(inputBuffer, transform) {
			try {
				const data = await toBuffer();
				return { data, format: transform.format };
			} catch {
				return { data: inputBuffer, format: "png" };
			}
		},
	};
}

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
const PRIVATE_ROUTE_WIDTHS = [320, 480, 640, 800, 828, 960, 1080, 1200, 1280, 1440, 1600, 1920, 2000, 2400, 2560];

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

test("the public image encoder retains the current cache namespace", () => {
	assert.equal(imageCacheSettings8({ service: { config: PUBLIC_IMAGE_ENCODER_CONFIG } }), "bc105be0");
	assert.equal(imageCacheSettings8({ service: imageService() }), "bc105be0");
});

test("imageService passes options to Astro's service config", () => {
	assert.deepEqual(imageService({
		publicWidths: [800],
		smallWidths: [400],
		privateWidths: [900],
		encoder: { avif: { quality: 56 }, webp: { quality: 70 } },
		cacheDirectory: "/tmp/image-cache",
		encodeLimit: 3,
		deniedStorageKeyPrefixes: ["blocked/"],
	}), {
		entrypoint: "@nimitzua/emdash-images/service",
		config: {
			avif: { quality: 56 },
			webp: { quality: 70 },
			publicWidths: [800],
			smallWidths: [400],
			privateWidths: [900],
			cacheDirectory: "/tmp/image-cache",
			encodeLimit: 3,
			deniedStorageKeyPrefixes: ["blocked/"],
		},
	});
});

test("the image service writes and reads under IMAGE_CACHE_DIR when config omits cacheDirectory", async () => {
	await withCacheDirectory(async (parentDirectory) => {
		const cacheDirectory = join(parentDirectory, "env-cache");
		const previousCacheDirectory = process.env.IMAGE_CACHE_DIR;
		process.env.IMAGE_CACHE_DIR = cacheDirectory;
		try {
			const descriptor = imageService();
			assert.equal(Object.hasOwn(descriptor.config, "cacheDirectory"), false,
				"the default image service config must not serialize a cache path");
			const config = { service: descriptor };
			let encoderCalls = 0;
			const service = createImageService(serviceWithEncoder(async (_input, transform) => {
				encoderCalls++;
				return { data: Buffer.from("encoded"), format: transform.format };
			}));
			const url = imageRequestUrl(publicImageTransform);
			await requestImageVariant(service, Buffer.from("original image"), url, { config });
			await requestImageVariant(service, Buffer.from("original image"), url, { config });

			const entries = await readdir(cacheDirectory, { recursive: true });
			assert.ok(entries.some((entry) => String(entry).endsWith("-640.webp")));
			assert.equal(encoderCalls, 1, "the second request reads the cached variant");
		} finally {
			if (previousCacheDirectory === undefined) delete process.env.IMAGE_CACHE_DIR;
			else process.env.IMAGE_CACHE_DIR = previousCacheDirectory;
		}
	});
});

test("IMAGE_CACHE_DIR takes precedence over a configured cacheDirectory", async () => {
	await withCacheDirectory(async (parentDirectory) => {
		const cacheDirectory = join(parentDirectory, "env-cache");
		const configuredCacheDirectory = join(parentDirectory, "configured-cache");
		const previousCacheDirectory = process.env.IMAGE_CACHE_DIR;
		process.env.IMAGE_CACHE_DIR = cacheDirectory;
		try {
			const config = { service: imageService({ cacheDirectory: configuredCacheDirectory }) };
			let encoderCalls = 0;
			const service = createImageService(serviceWithEncoder(async (_input, transform) => {
				encoderCalls++;
				return { data: Buffer.from("encoded"), format: transform.format };
			}));
			const url = imageRequestUrl(publicImageTransform);
			await requestImageVariant(service, Buffer.from("original image"), url, { config });
			await requestImageVariant(service, Buffer.from("original image"), url, { config });

			const envEntries = await readdir(cacheDirectory, { recursive: true }).catch(() => []);
			const configuredEntries = await readdir(configuredCacheDirectory, { recursive: true }).catch(() => []);
			assert.ok(envEntries.some((entry) => String(entry).endsWith("-640.webp")),
				"the environment cache directory receives the variant");
			assert.deepEqual(configuredEntries, [], "the configured cache directory is not used");
			assert.equal(encoderCalls, 1, "the second request reads the cached variant");
		} finally {
			if (previousCacheDirectory === undefined) delete process.env.IMAGE_CACHE_DIR;
			else process.env.IMAGE_CACHE_DIR = previousCacheDirectory;
		}
	});
});

test("denied storage-key prefixes bypass variants while an empty list allows them", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const hash16 = "0123456789abcdef";
		const cacheConfig = { service: { config: PUBLIC_IMAGE_ENCODER_CONFIG } };
		const cachePath = imageVariantCachePath(cacheDirectory, "01TESTMEDIA", hash16, 640, "webp", cacheConfig);
		await mkdir(dirname(cachePath), { recursive: true });
		await writeFile(cachePath, Buffer.from("cached public variant"));

		let encoderCalls = 0;
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			encoderCalls++;
			return { data: Buffer.from("freshly encoded"), format: transform.format };
		}), { cacheDirectory });
		const transform = {
			src: "https://site.test/_emdash/api/media/file/Blocked/Case/photo.png",
			width: 640,
			format: "webp",
			fit: "cover",
		};
		const imageConfigWithDeniedPrefixes = (deniedStorageKeyPrefixes) => ({
			service: { config: { ...PUBLIC_IMAGE_ENCODER_CONFIG, deniedStorageKeyPrefixes } },
		});
		const transformWithPrefixes = (deniedStorageKeyPrefixes) => runWithImageCacheContext({
			mediaId: "01TESTMEDIA",
			hash16,
			originalWidth: 1280,
		}, () => service.transform(
			Buffer.from("original image"),
			transform,
			imageConfigWithDeniedPrefixes(deniedStorageKeyPrefixes),
			{},
		));

		const denied = await transformWithPrefixes(["blocked/"]);
		assert.deepEqual(denied.data, Buffer.from("freshly encoded"), "a denied source key skips its cached public variant");
		const allowed = await transformWithPrefixes([]);
		assert.deepEqual(allowed.data, Buffer.from("cached public variant"), "an empty deny list does not block the cache");
		assert.equal(encoderCalls, 1);
	});
});

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
	const { runWithImageCacheContext } = await import("../src/service.mjs");
	if (typeof runWithImageCacheContext !== "function") return runTransform();
	return runWithImageCacheContext({
		mediaId: "01TESTMEDIA",
		hash16: undefined,
		originalWidth: transform.width < 640 && ![320, 480].includes(transform.width) ? transform.width : transform.width + 1,
		...cacheContext,
	}, runTransform);
}

test("throws after a persistent format mismatch without caching wrong-format bytes", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let encoderCalls = 0;
		const service = createImageService(serviceWithEncoder(async () => {
			encoderCalls++;
			return { data: Buffer.from("png fallback"), format: "png" };
		}), { cacheDirectory, encodeLimiter: createImageEncodeLimiter(2) });
		const warnings = [];
		const originalWarn = console.warn;
		console.warn = (message) => warnings.push(String(message));
		try {
			await assert.rejects(
				requestImageVariant(service, Buffer.from("original image"), imageRequestUrl({ ...publicImageTransform, format: "avif" })),
				/returned png.*requested avif/i,
			);
		} finally {
			console.warn = originalWarn;
		}

		assert.equal(encoderCalls, 2, "the underlying encoder should be attempted twice");
		assert.equal(warnings.length, 1, "a persistent format mismatch should produce one warning line");
		assert.match(warnings[0], /photo\.png/);
		assert.match(warnings[0], /requested=avif/);
		assert.match(warnings[0], /returned=png/);
		assert.match(warnings[0], /640x/);
		assert.match(warnings[0], /12 bytes/);
		assert.deepEqual(await readdir(cacheDirectory, { recursive: true }), [],
			"the failed transform leaves no variant in the cache");
	});
});

test("runs five different encodes two at a time in FIFO order", async () => {
	const started = [];
	const releases = [];
	let active = 0;
	let maxActive = 0;
	let completed = 0;
	let releaseAll = false;
	const service = createImageService(serviceWithEncoder(async (_input, transform) => {
		started.push(transform.width);
		active++;
		maxActive = Math.max(maxActive, active);
		return new Promise((resolve) => {
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				active--;
				completed++;
				resolve({ data: Buffer.from(String(transform.width)), format: transform.format });
			};
			releases.push(release);
			if (releaseAll) release();
		});
	}), { encodeLimiter: createImageEncodeLimiter(2) });
	const widths = [641, 642, 643, 644, 645];
	const jobs = widths.map((width) => service.transform(Buffer.from("original"), {
		src: "/images/photo.png",
		width,
		format: "webp",
	}, imageConfig(), {}));
	const allJobs = Promise.all(jobs);
	const waitForStarted = async (count) => {
		const deadline = Date.now() + 2_000;
		while (started.length < count && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
	};

	try {
		await waitForStarted(2);
		assert.deepEqual(started, widths.slice(0, 2), "only the first two encodes start before a slot frees");
		assert.equal(maxActive, 2);
		for (let index = 0; index < widths.length - 2; index++) {
			releases[index]();
			await waitForStarted(index + 3);
			assert.deepEqual(started, widths.slice(0, index + 3), "queued encodes start in request order");
		}
		releases[3]();
		releases[4]();
		await allJobs;
		assert.equal(completed, 5, "all five encodes complete");
		assert.equal(maxActive, 2, "no more than two encodes run at once");
	} finally {
		releaseAll = true;
		for (let index = 0; index < widths.length + 2; index++) {
			for (const release of releases) release();
			await new Promise((resolve) => setImmediate(resolve));
		}
		await Promise.allSettled(jobs);
	}
});

test("a throwing encode releases its slot for the next queued encode", async () => {
	const started = [];
	let rejectFirst;
	let releaseSecond;
	const service = createImageService(serviceWithEncoder(async (_input, transform) => {
		started.push(transform.width);
		if (transform.width === 641) {
			await new Promise((_resolve, reject) => {
				rejectFirst = () => reject(new Error("synthetic encode failure"));
			});
		}
		if (transform.width === 642) {
			await new Promise((resolve) => {
				releaseSecond = () => resolve({ data: Buffer.from("642"), format: transform.format });
			});
		}
		return { data: Buffer.from(String(transform.width)), format: transform.format };
	}), { encodeLimiter: createImageEncodeLimiter(2) });
	const transform = (width) => service.transform(Buffer.from("original"), {
		src: "/images/photo.png",
		width,
		format: "webp",
	}, imageConfig(), {});
	const first = transform(641);
	const second = transform(642);
	const third = transform(643);
	const allJobs = Promise.allSettled([first, second, third]);
	const waitForStarted = async (count) => {
		const deadline = Date.now() + 2_000;
		while (started.length < count && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
	};

	try {
		await waitForStarted(2);
		assert.deepEqual(started, [641, 642], "the third encode waits while both slots are occupied");
		rejectFirst();
		await assert.rejects(first, /synthetic encode failure/);
		await waitForStarted(3);
		assert.deepEqual(started, [641, 642, 643], "the queued third encode starts after the first throws");
	} finally {
		rejectFirst?.();
		releaseSecond?.();
	}
	const [, secondResult, thirdResult] = await allJobs;
	assert.equal(secondResult.status, "fulfilled");
	assert.equal(thirdResult.status, "fulfilled");
	assert.equal(secondResult.value.format, "webp");
	assert.equal(thirdResult.value.format, "webp");
});

test("returns the requested format after the retry recovers", async () => {
	const input = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
	let toBufferCalls = 0;
	const service = createImageService(serviceWithToBuffer(async () => {
		toBufferCalls++;
		if (toBufferCalls === 1) throw new Error("synthetic first Sharp rejection");
		return Uint8Array.from([0, 1, 2]);
	}));
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => warnings.push(args);
	let result;
	try {
		result = await service.transform(input, {
			src: "/images/photo.png",
			width: 640,
			format: "webp",
		}, { service: { config: {} } }, { warn() {} });
	} finally {
		console.warn = originalWarn;
	}

	assert.equal(toBufferCalls, 2);
	assert.equal(result.format, "webp");
	assert.deepEqual(result.data, Uint8Array.from([0, 1, 2]));
	assert.deepEqual(warnings, []);
});

test("serves a disk-cached variant after service recreation without encoding again", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let firstProcessCalls = 0;
		let restartedProcessCalls = 0;
		const encodedHeights = [];
		const options = { cacheDirectory };
		const firstProcess = createImageService(serviceWithEncoder(async (input, transform) => {
			firstProcessCalls++;
			encodedHeights.push(transform.height);
			return { data: Buffer.from(`${input.toString()}:${transform.width}:${transform.format}`), format: transform.format };
		}), options);
		const url = imageRequestUrl(publicImageTransform);
		const first = await requestImageVariant(firstProcess, Buffer.from("original image"), url);
		const repeated = await requestImageVariant(firstProcess, Buffer.from("original image"), url);

		const restartedProcess = createImageService(serviceWithEncoder(async (_input, transform) => {
			restartedProcessCalls++;
			return { data: Buffer.from("unexpected re-encode"), format: transform.format };
		}), options);
		const second = await requestImageVariant(restartedProcess, Buffer.from("original image"), url);

		assert.equal(firstProcessCalls, 1);
		assert.deepEqual(repeated.data, first.data, "a repeated request for the same URL reuses its first encoding");
		assert.equal(restartedProcessCalls, 0, "a newly created service uses the existing on-disk variant");
		assert.deepEqual(encodedHeights, [undefined]);
		assert.deepEqual(second.data, first.data);
		const files = await readdir(cacheDirectory, { recursive: true });
		assert.equal(files.filter((file) => /^v2-[0-9a-f]{8}\/01TESTMEDIA\/[0-9a-f]{16}-640\.webp$/.test(String(file))).length, 1,
			"the cache uses a settings namespace, media id, content hash, width, and format");
	});
});

test("separate image-service module copies share the request context", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const middlewareCopy = await import("../src/service.mjs?copy=middleware");
		const astroAssetsCopy = await import("../src/service.mjs?copy=astro-assets");
		const input = await sharp({
			create: { width: 1280, height: 1, channels: 3, background: { r: 240, g: 240, b: 240 } },
		}).png().toBuffer();
		const service = astroAssetsCopy.createImageService(
			serviceWithEncoder(async (_input, transform) => ({
				data: Buffer.from(`encoded:${transform.width}:${transform.format}`),
				format: transform.format,
			})),
			{ cacheDirectory },
		);
		const cacheContext = {
			mediaId: "01TESTMEDIA",
			hash16: "0123456789abcdef",
			originalWidth: 1280,
		};

		await middlewareCopy.runWithImageCacheContext(cacheContext, () =>
			service.transform(input, publicImageTransform, imageConfig(), {}),
		);

		const files = await readdir(cacheDirectory, { recursive: true });
		assert.ok(files.some((file) => /^v2-[0-9a-f]{8}\/01TESTMEDIA\/0123456789abcdef-640\.webp$/.test(String(file))),
			"the transform should read the request context established by another module copy");
	});
});

test("explicit height transforms bypass the cache", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let calls = 0;
		const heights = [];
		const service = createImageService(serviceWithEncoder(async (input, transform) => {
			calls++;
			heights.push(transform.height);
			return { data: Buffer.from(`${input.toString()}:${transform.width}x${transform.height}`), format: transform.format };
		}), { cacheDirectory });
		const transform = { ...publicImageTransform, height: 320 };

		const { runWithImageCacheContext } = await import("../src/service.mjs");
		await runWithImageCacheContext({ originalWidth: 640 }, () => service.transform(Buffer.from("original image"), transform, imageConfig(), {}));
		await runWithImageCacheContext({ originalWidth: 640 }, () => service.transform(Buffer.from("original image"), transform, imageConfig(), {}));

		assert.equal(calls, 2);
		assert.deepEqual(heights, [320, 320]);
		assert.deepEqual(await readdir(cacheDirectory), []);
	});
});

test("cache namespace includes both encoder settings and the installed Sharp version", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const input = Buffer.from("original image");
		const firstConfig = { service: { config: { avif: { effort: 2 }, webp: { quality: 75 } } } };
		const secondConfig = { service: { config: { avif: { effort: 3 }, webp: { quality: 75 } } } };
		const url = imageRequestUrl(publicImageTransform);
		const service = createImageService(serviceWithEncoder(async (_input, transform) => ({
			data: Buffer.from("encoded"),
			format: transform.format,
		})), { cacheDirectory });
		await requestImageVariant(service, input, url, { config: firstConfig });
		await requestImageVariant(service, input, url, { config: secondConfig });

		const files = await readdir(cacheDirectory, { recursive: true });
		const namespaces = [...new Set(files.map((file) => String(file).split("/")[0]).filter((path) => path.startsWith("v2-")))];
		assert.equal(namespaces.length, 2, "changing either format's encoder settings creates a separate cache namespace");
		assert.ok(namespaces.every((path) => /^v2-[0-9a-f]{8}$/.test(path)));
	});
});

test("a missing row hash uses EmDash's content hash in the v2 filename", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const input = Buffer.from("media whose row has not been backfilled");
		const service = createImageService(serviceWithEncoder(async (_bytes, transform) => ({
			data: Buffer.from("encoded"),
			format: transform.format,
		})), { cacheDirectory });
		await requestImageVariant(service, input, imageRequestUrl(publicImageTransform), {
			cacheContext: { mediaId: "media-without-hash", originalWidth: 1280 },
		});

		const emdashHash = await computeContentHash(input);
		const hash16 = emdashHash.slice("sha1:".length, "sha1:".length + 16);
		const files = await readdir(cacheDirectory, { recursive: true });
		assert.ok(files.some((file) => new RegExp(`^v2-[0-9a-f]{8}/media-without-hash/${hash16}-640\\.webp$`).test(String(file))),
			"the buffer fallback matches the content-hash version EmDash will later backfill");
	});
});

test("the transform refuses widths larger than the original before encoding or caching", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let encoderCalls = 0;
		const service = createImageService(serviceWithEncoder(async (_bytes, transform) => {
			encoderCalls++;
			return { data: Buffer.from("encoded"), format: transform.format };
		}), { cacheDirectory });
		await assert.rejects(
			requestImageVariant(service, Buffer.from("original image"), imageRequestUrl({ ...publicImageTransform, width: 640 }), {
				cacheContext: { mediaId: "narrow-original", originalWidth: 639 },
			}),
			/Image variant not found/,
		);
		assert.equal(encoderCalls, 0);
		assert.deepEqual(await readdir(cacheDirectory).catch(() => []), [], "an oversized request creates no cache directory or file");
	});
});

test("a sub-minimum width is cached only when it matches the source width", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const input = await sharp({
			create: { width: 604, height: 666, channels: 3, background: { r: 240, g: 240, b: 240 } },
		}).png().toBuffer();
		const requestedWidths = [];
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			requestedWidths.push(transform.width);
			return { data: Buffer.from(`encoded ${transform.width}`), format: transform.format };
		}), { cacheDirectory });

		await requestImageVariant(service, input, imageRequestUrl({ ...publicImageTransform, width: 604 }));
		await requestImageVariant(service, input, imageRequestUrl({ ...publicImageTransform, width: 604 }));
		const unsupportedVariant = await service.parseURL(
			new URL(imageRequestUrl({ ...publicImageTransform, width: 603 })), imageConfig(), {},
		);
		assert.equal(unsupportedVariant?.width, 603,
			"the transform validates sub-minimum variants after loading source bytes");
		await assert.rejects(
			service.transform(input, unsupportedVariant, imageConfig(), {}),
			/not found/,
			"a different sub-minimum width is rejected before EmDash can stream the original image",
		);

		assert.deepEqual(requestedWidths, [604], "only the exact source width reaches the encoder");
		const files = await readdir(cacheDirectory, { recursive: true });
		assert.equal(files.filter((file) => /\.webp$/.test(String(file))).length, 1,
			"only one sub-minimum width is persisted for the source");
	});
});

test("listed sub-minimum widths are encoded and cached for a wider public source", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const input = await sharp({
			create: { width: 604, height: 666, channels: 3, background: { r: 240, g: 240, b: 240 } },
		}).png().toBuffer();
		const requestedWidths = [];
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			requestedWidths.push(transform.width);
			return { data: Buffer.from(`encoded ${transform.width}`), format: transform.format };
		}), { cacheDirectory });

		assert.deepEqual(PUBLIC_IMAGE_SMALL_WIDTHS, [320, 480],
			"the small responsive widths are separately allowlisted");
		assert.deepEqual(PUBLIC_IMAGE_WIDTHS, [640, 1080, 1600, 1920, 2400],
			"existing standard public widths stay unchanged");
		for (const width of [320, 480]) {
			const url = imageRequestUrl({ ...publicImageTransform, width });
			await requestImageVariant(service, input, url);
			await requestImageVariant(service, input, url);
		}

		assert.deepEqual(requestedWidths, [320, 480],
			"each listed sub-original width is encoded once and repeated requests use its cache entry");
		const files = await readdir(cacheDirectory, { recursive: true });
		assert.equal(files.filter((file) => /\.webp$/.test(String(file))).length, 2,
			"the cache contains only the two requested image variants");
	});
});

test("custom responsive widths retain standard variants up to the source width", async () => {
	const { publicResponsiveImageWidths } = await import("../src/service.mjs");
	assert.deepEqual(
		publicResponsiveImageWidths?.(1200, [320, 480]),
		[320, 480, 640, 1080],
		"small custom candidates supplement the standard widths that fit the source",
	);
});

test("a listed small width rejects a source no wider than the requested variant", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const input = await sharp({
			create: { width: 300, height: 450, channels: 3, background: { r: 240, g: 240, b: 240 } },
		}).png().toBuffer();
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			calls++;
			return { data: Buffer.from(`encoded ${transform.width}`), format: transform.format };
		}), { cacheDirectory });
		const transform = await service.parseURL(
			new URL(imageRequestUrl({ ...publicImageTransform, width: 480 })), imageConfig(), {},
		);

		assert.equal(transform?.width, 480,
			"the listed public width reaches source-byte validation");
		await assert.rejects(
			service.transform(input, transform, imageConfig(), {}),
			/Image variant not found/,
			"a 480 px response is unavailable when the source is only 300 px wide",
		);

		assert.equal(calls, 0, "an undersized source never reaches the encoder");
		const files = await readdir(cacheDirectory, { recursive: true });
		assert.equal(files.filter((file) => /\.webp$/.test(String(file))).length, 0,
			"an undersized source does not create a duplicate cache entry");
	});
});

test("a fresh service transforms the bread-like 604px source to AVIF without render state", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const input = await sharp({
			create: { width: 604, height: 666, channels: 3, background: { r: 183, g: 132, b: 87 } },
		}).png().toBuffer();
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (bytes, transform) => {
			calls++;
			const data = await sharp(bytes).resize({ width: transform.width }).avif().toBuffer();
			return { data, format: transform.format };
		}), { cacheDirectory });
		const breadSource = "https://site.test/_emdash/api/media/file/01M4TPDJ6GXM1Q03ABKFKA5KPC.png";
		const result = await requestImageVariant(service, input, imageRequestUrl({
			src: breadSource,
			width: 604,
			format: "avif",
			fit: "cover",
		}));

		assert.equal(calls, 1, "the fresh service did not need a prior getURL/render call");
		assert.equal(result.format, "avif");
		assert.match(result.data.subarray(4, 16).toString("ascii"), /avif/,
			"the response body has an AVIF file-type brand");
		assert.equal((await sharp(result.data).metadata()).width, 604);
	});
});

test("a sub-minimum width accepts the oriented width of a rotated JPEG", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		const input = await sharp({
			create: { width: 500, height: 604, channels: 3, background: { r: 183, g: 132, b: 87 } },
		}).jpeg().withMetadata({ orientation: 6 }).toBuffer();
		const service = createImageService(serviceWithEncoder(async (bytes, transform) => {
			const data = await sharp(bytes).rotate().resize({ width: transform.width }).avif().toBuffer();
			return { data, format: transform.format };
		}), { cacheDirectory });
		const rotatedSource = "https://site.test/_emdash/api/media/file/01M4TPDJ6GXM1Q03ABKFKA5KPC.jpg";
		const result = await requestImageVariant(service, input, imageRequestUrl({
			src: rotatedSource,
			width: 604,
			format: "avif",
			fit: "cover",
		}));

		assert.equal(result.format, "avif");
		assert.equal((await sharp(result.data).metadata()).width, 604,
			"the transformed output preserves the source's EXIF-oriented width");
	});
});

test("concurrent requests for one missing public variant share a single encode", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (input, transform) => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 10));
			return { data: Buffer.from(`${input.toString()}:${transform.width}:${transform.format}`), format: transform.format };
		}), { cacheDirectory });
		const url = imageRequestUrl(publicImageTransform);
		const results = await Promise.all(Array.from({ length: 8 }, () =>
			requestImageVariant(service, Buffer.from("original image"), url),
		));

		assert.equal(calls, 1);
		for (const result of results.slice(1)) assert.deepEqual(result.data, results[0].data);
	});
});

test("a replacement source at the same media URL gets a new cache identity", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (input, transform) => {
			calls++;
			return { data: Buffer.from(`${input.toString()}:${transform.width}:${transform.format}`), format: transform.format };
		}), { cacheDirectory });
		const url = imageRequestUrl(publicImageTransform);
		const before = await requestImageVariant(service, Buffer.from("old source bytes"), url);
		const after = await requestImageVariant(service, Buffer.from("replacement source bytes"), url);

		assert.equal(calls, 2);
		assert.notDeepEqual(after.data, before.data);
	});
});

test("percent-encoded variants of one media URL share one cached file", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (input, transform) => {
			calls++;
			return { data: Buffer.from(`${input.toString()}:${transform.width}:${transform.format}`), format: transform.format };
		}), { cacheDirectory });
		const sourceUrls = [
			"https://site.test/_emdash/api/media/file/work/photo.png",
			"https://site.test/_emdash/api/media/file/work/%70hoto.png",
		];

		for (const src of sourceUrls) {
			await requestImageVariant(service, Buffer.from("same original bytes"), imageRequestUrl({ ...publicImageTransform, src }));
		}

		const files = await readdir(cacheDirectory, { recursive: true });
		assert.equal(calls, 1);
		assert.equal(files.filter((file) => /\.(avif|webp)$/.test(String(file))).length, 1, "both URL spellings resolve to one variant file");
	});
});

test("width-only fit options share the same cached variant", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (input, transform) => {
			calls++;
			return { data: Buffer.from(`${input.toString()}:${transform.width}:${transform.format}`), format: transform.format };
		}), { cacheDirectory });

		await requestImageVariant(service, Buffer.from("same original bytes"), imageRequestUrl(publicImageTransform));
		await requestImageVariant(service, Buffer.from("same original bytes"), imageRequestUrl({ ...publicImageTransform, fit: undefined }));

		assert.equal(calls, 1);
	});
});

test("public URLs allow only listed widths and image formats without dimension or quality options", async () => {
	const service = createImageService(serviceWithEncoder(async (_input, transform) => ({
		data: Buffer.from("encoded"),
		format: transform.format,
	})), { cacheDirectory: "/unused" });
	const parse = (href, width, format, extra = "") => service.parseURL(
		new URL(`https://site.test/_image?href=${encodeURIComponent(href)}&w=${width}&f=${format}${extra}`),
		imageConfig(),
		{},
	);

	assert.deepEqual(await parse(publicImageTransform.src, 640, "avif", "&fit=cover"), {
		src: publicImageTransform.src,
		width: 640,
		height: undefined,
		format: "avif",
		fit: "cover",
	});
	assert.equal((await parse(publicImageTransform.src, 604, "webp"))?.width, 604,
		"a sub-minimum public width is checked against loaded source bytes during transform");
	assert.equal((await parse(publicImageTransform.src, 603, "webp"))?.width, 603,
		"a potentially invalid sub-minimum width reaches the transform for source-byte validation");
	for (const width of PUBLIC_IMAGE_WIDTHS) {
		assert.equal((await parse(publicImageTransform.src, width, "webp"))?.width, width);
	}
	assert.equal(await parse(publicImageTransform.src, 641, "webp"), undefined);
	for (const option of ["&h=320", "&q=75", "&position=top", "&background=%23ffffff"]) {
		assert.equal(await parse(publicImageTransform.src, 640, "webp", option), undefined, `${option} is not accepted`);
	}
	assert.equal(await parse(publicImageTransform.src, 640, "png"), undefined);
	assert.equal(await parse("https://site.test/uploads/unlisted.png", 640, "webp"), undefined);
	assert.equal(
		(await parse("https://elsewhere.test/_emdash/api/media/file/work/photo.png", 640, "webp"))?.src,
		"https://elsewhere.test/_emdash/api/media/file/work/photo.png",
		"Astro remote-source authorization owns the allowed source origins",
	);
	const internalRequest = new URL(imageRequestUrl(publicImageTransform).replace("https://site.test/_image", "http://site:4321/_image"));
	assert.equal((await service.parseURL(internalRequest, imageConfig(), {}))?.src, publicImageTransform.src,
		"the image service accepts internal and proxied request origins");

	for (const width of PRIVATE_ROUTE_WIDTHS) {
		const privateTransform = await parse("https://site.test/_emdash/api/media/file/private-cases/case/image.png", width, "webp", "&fit=cover");
		assert.equal(privateTransform?.width, width, `the private media route's ${width}px transform remains accepted`);
	}
});

test("public image URL parsing rejects unknown and repeated parameters", async () => {
	const service = createImageService(serviceWithEncoder(async (_input, transform) => ({
		data: Buffer.from("encoded"),
		format: transform.format,
	})), { cacheDirectory: "/unused" });
	const base = new URL(imageRequestUrl(publicImageTransform));
	const duplicateParams = ["href", "w", "f", "fit"];
	for (const name of duplicateParams) {
		const url = new URL(base);
		url.searchParams.append(name, url.searchParams.get(name) ?? "640");
		assert.equal(await service.parseURL(url, imageConfig(), {}), undefined, `repeated ${name} is rejected`);
	}
	const repeatedVersion = new URL(base);
	repeatedVersion.searchParams.set("v", "0123456789abcdef");
	repeatedVersion.searchParams.append("v", "0123456789abcdef");
	assert.equal(await service.parseURL(repeatedVersion, imageConfig(), {}), undefined, "repeated v is rejected");
	const unknown = new URL(base);
	unknown.searchParams.set("cache", "bust");
	assert.equal(await service.parseURL(unknown, imageConfig(), {}), undefined, "unknown parameters are rejected");
});

test("getURL carries one media version and parseURL rejects malformed or repeated versions", async () => {
	const delegatedTransforms = [];
	const htmlAttributeTransforms = [];
	let parseCalls = 0;
	const service = createImageService({
		getURL(transform) {
			delegatedTransforms.push(transform);
			const url = new URL("/_image", "https://site.test");
			url.searchParams.set("href", transform.src);
			url.searchParams.set("w", String(transform.width));
			url.searchParams.set("f", transform.format);
			return url.href;
		},
		parseURL(url) {
			parseCalls++;
			return {
				src: url.searchParams.get("href"),
				width: Number(url.searchParams.get("w")),
				format: url.searchParams.get("f"),
			};
		},
		getHTMLAttributes(transform) {
			htmlAttributeTransforms.push(transform);
			return { ...transform };
		},
		async transform(_input, transform) {
			return { data: Buffer.from(transform.format), format: transform.format };
		},
	}, { cacheDirectory: "/unused" });
	const mediaVersion = "0123456789abcdef";
	const generated = await service.getURL({ ...publicImageTransform, mediaVersion }, imageConfig(), {});
	const generatedUrl = new URL(generated);
	assert.equal(generatedUrl.searchParams.get("v"), mediaVersion);
	assert.equal(delegatedTransforms[0].mediaVersion, undefined,
		"the custom prop is removed before the underlying service builds transform options");
	assert.equal(delegatedTransforms[0].height, undefined,
		"public generated transforms keep the established height-free behavior");
	const attributes = service.getHTMLAttributes({ ...publicImageTransform, mediaVersion }, imageConfig(), {});
	assert.equal(htmlAttributeTransforms[0].mediaVersion, undefined,
		"the cache version stays out of rendered HTML attributes");
	assert.equal(attributes.mediaVersion, undefined);
	assert.equal((await service.parseURL(generatedUrl, imageConfig(), {}))?.width, 640);
	assert.equal(parseCalls, 1);

	const malformed = new URL(generated);
	malformed.searchParams.set("v", "0123456789abcdeZ");
	assert.equal(await service.parseURL(malformed, imageConfig(), {}), undefined);
	const repeated = new URL(generated);
	repeated.searchParams.append("v", mediaVersion);
	assert.equal(await service.parseURL(repeated, imageConfig(), {}), undefined);
	assert.equal(parseCalls, 1, "invalid version parameters are rejected before delegating to Astro");

	const unversioned = await service.getURL({ ...publicImageTransform }, imageConfig(), {});
	assert.equal(new URL(unversioned).searchParams.has("v"), false);
	const privateImage = await service.getURL({
		...publicImageTransform,
		src: "https://site.test/_emdash/api/media/file/private-cases/case/photo.png",
		mediaVersion,
	}, imageConfig(), {});
	assert.equal(new URL(privateImage).searchParams.has("v"), false,
		"private storage keys never receive a public cache version");
});

test("a valid version does not change the encoded image transform", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (_input, transform) => {
			calls++;
			return { data: Buffer.from(`${transform.width}:${transform.format}`), format: transform.format };
		}), { cacheDirectory });
		const unversionedUrl = imageRequestUrl(publicImageTransform);
		const versionedUrl = new URL(unversionedUrl);
		versionedUrl.searchParams.set("v", "0123456789abcdef");

		const unversioned = await requestImageVariant(service, Buffer.from("original image"), unversionedUrl);
		const versioned = await requestImageVariant(service, Buffer.from("original image"), versionedUrl);

		assert.deepEqual(versioned.data, unversioned.data);
		assert.equal(calls, 1, "the cache identity and encoder input do not include v");
	});
});

test("private media transforms are not persisted to the public disk cache", async () => {
	await withCacheDirectory(async (cacheDirectory) => {
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (input, transform) => {
			calls++;
			return { data: Buffer.from(`${input.toString()}:${transform.width}:${transform.format}`), format: transform.format };
		}), { cacheDirectory });
		const privateTransform = {
			...publicImageTransform,
			src: "https://site.test/_emdash/api/media/file/private-cases%252Fcase/image.png",
			width: PRIVATE_IMAGE_WIDTHS[0],
		};

		const privateUrl = imageRequestUrl(privateTransform);
		await requestImageVariant(service, Buffer.from("private image"), privateUrl);
		await requestImageVariant(service, Buffer.from("private image"), privateUrl);

		assert.equal(calls, 2);
		assert.deepEqual(await readdir(cacheDirectory), []);
	});
});

test("unwritable cache directories produce one clear error and keep serving transforms", async () => {
	await withCacheDirectory(async (parentDirectory) => {
		const cacheDirectory = join(parentDirectory, "not-a-directory");
		await writeFile(cacheDirectory, "block cache directory creation");
		let calls = 0;
		const service = createImageService(serviceWithEncoder(async (input, transform) => {
			calls++;
			return { data: Buffer.from(`${input.toString()}:${transform.width}:${transform.format}`), format: transform.format };
		}), { cacheDirectory });
		const errors = [];
		const originalError = console.error;
		console.error = (message) => errors.push(String(message));
		try {
			await requestImageVariant(service, Buffer.from("original image"), imageRequestUrl(publicImageTransform));
			await requestImageVariant(service, Buffer.from("original image"), imageRequestUrl(publicImageTransform));
		} finally {
			console.error = originalError;
		}

		assert.equal(calls, 2, "uncached transforms still return successfully after the cache directory check fails");
		assert.equal(errors.length, 1, "the directory problem is logged once for the service lifetime");
		assert.match(errors[0], /image-cache.*writ/i);
	});
});
