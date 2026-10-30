import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import { DEFAULT_IMAGE_OPTIONS, imageVariantCachePath } from "../src/index.mjs";
import {
	createImageWarmupScheduler,
	createLocalWarmupOrigins,
	extractImageVariantUrls,
	extractSitemapLocations,
	isImageWarmupEnabled,
	mapSiteUrlToRequestUrl,
	warmPublicSite,
} from "../src/warmup.mjs";

test("extracts public image variants once while skipping private media", () => {
	const origin = new URL("https://site.example");
	const siteOptions = {
		deniedStorageKeyPrefixes: ["private-cases/"],
		deniedPagePathPrefixes: ["/private"],
	};
	const publicImage = (width, format) =>
		`/_image?href=https%3A%2F%2Fsite.example%2F_emdash%2Fapi%2Fmedia%2Ffile%2Fpublic.png&amp;w=${width}&amp;f=${format}&amp;v=0123456789abcdef`;
	const html = `
		<picture><source srcset="${publicImage(320, "avif")} 320w, ${publicImage(480, "avif")} 480w"></picture>
		<img srcset="${publicImage(320, "avif")} 320w, ${publicImage(640, "webp")} 640w">
		<img srcset="/private/link-token/media/poster?w=320&amp;f=avif 320w">
		<img srcset="/_image?href=https%3A%2F%2Fsite.example%2F_emdash%2Fapi%2Fmedia%2Ffile%2Fprivate-cases%2Fcase%2Fimage.png&amp;w=640&amp;f=webp 640w">
	`;

	assert.deepEqual(extractImageVariantUrls(html, origin, siteOptions), [
		`https://site.example${publicImage(320, "avif").replaceAll("&amp;", "&")}`,
		`https://site.example${publicImage(480, "avif").replaceAll("&amp;", "&")}`,
		`https://site.example${publicImage(640, "webp").replaceAll("&amp;", "&")}`,
	]);
});

test("warm-up skips only the page and storage prefixes supplied by the site", () => {
	const origin = new URL("https://site.example");
	const publicImage = `https://site.example/_image?href=${encodeURIComponent("https://site.example/_emdash/api/media/file/public/image.png")}&w=640&f=webp`;
	const privateImage = `https://site.example/_image?href=${encodeURIComponent("https://site.example/_emdash/api/media/file/private-cases/case/image.png")}&w=640&f=webp`;
	const html = `<img srcset="${privateImage} 640w, ${publicImage} 640w">`;
	const noDeniedPrefixes = { deniedStorageKeyPrefixes: [], deniedPagePathPrefixes: [] };
	const sitePrefixes = {
		deniedStorageKeyPrefixes: ["private-cases/"],
		deniedPagePathPrefixes: ["/private"],
	};

	assert.deepEqual(extractImageVariantUrls(html, origin, noDeniedPrefixes), [privateImage, publicImage]);
	assert.deepEqual(extractImageVariantUrls(html, origin, sitePrefixes), [publicImage]);
	for (const storageKey of [
		"private-cases//case/image.png",
		"private-cases/",
		"private-cases/%252e%252e/x",
	]) {
		const image = `https://site.example/_image?href=${encodeURIComponent(`https://site.example/_emdash/api/media/file/${storageKey}`)}&w=640&f=webp`;
		const malformedPrivateHtml = `<img srcset="${image} 640w">`;
		assert.deepEqual(extractImageVariantUrls(malformedPrivateHtml, origin, noDeniedPrefixes), [image], storageKey);
		assert.deepEqual(extractImageVariantUrls(malformedPrivateHtml, origin, sitePrefixes), [], storageKey);
	}
	assert.equal(
		mapSiteUrlToRequestUrl("https://site.example/private", origin, origin, noDeniedPrefixes)?.pathname,
		"/private",
	);
	assert.equal(mapSiteUrlToRequestUrl("https://site.example/private", origin, origin, sitePrefixes), undefined);
	assert.equal(
		mapSiteUrlToRequestUrl("https://site.example/private-case", origin, origin, sitePrefixes)?.pathname,
		"/private-case",
	);
});

test("extracts child sitemap and page locations from XML", () => {
	assert.deepEqual(extractSitemapLocations(`
		<sitemapindex>
			<sitemap><loc>https://site.example/sitemap-cases.xml</loc></sitemap>
		</sitemapindex>
		<urlset>
			<url><loc>https://site.example/uk/work/sample?x=1&amp;y=2</loc></url>
		</urlset>
	`), [
		"https://site.example/sitemap-cases.xml",
		"https://site.example/uk/work/sample?x=1&y=2",
	]);
});

test("maps same-origin paths to the request origin and rejects private or external URLs", () => {
	const publicOrigin = new URL("https://site.example");
	const requestOrigin = new URL("http://127.0.0.1:4321");
	const siteOptions = {
		deniedStorageKeyPrefixes: ["private-cases/"],
		deniedPagePathPrefixes: ["/private"],
	};
	assert.equal(
		mapSiteUrlToRequestUrl("https://site.example/uk/work/sample?draft=1", publicOrigin, requestOrigin)?.href,
		"http://127.0.0.1:4321/uk/work/sample?draft=1",
	);
	assert.equal(mapSiteUrlToRequestUrl("https://other.example/", publicOrigin, requestOrigin), undefined);
	assert.equal(mapSiteUrlToRequestUrl("https://site.example/private/token/media/1", publicOrigin, requestOrigin, siteOptions), undefined);
});

test("local warm-up uses loopback while retaining the configured public origin", () => {
	const origins = createLocalWarmupOrigins({ PORT: "4321", SITE_PORT: "4642", EMDASH_SITE_URL: "https://stage.example" });
	assert.equal(origins.requestOrigin.href, "http://127.0.0.1:4321/");
	assert.equal(origins.publicOrigin.href, "https://stage.example/");

	const devOrigins = createLocalWarmupOrigins({ SITE_PORT: "4642", EMDASH_SITE_URL: "http://localhost:4642" });
	assert.equal(devOrigins.requestOrigin.href, "http://127.0.0.1:4642/");
	assert.throws(() => createLocalWarmupOrigins({ PORT: "0", EMDASH_SITE_URL: "https://stage.example" }), /valid PORT or SITE_PORT/);
});

test("warm-up is disabled outside production unless explicitly enabled", () => {
	assert.equal(isImageWarmupEnabled({ NODE_ENV: "development" }), false);
	assert.equal(isImageWarmupEnabled({ NODE_ENV: "test", IMAGE_WARMUP_ON_PUBLISH: "1" }), true);
	assert.equal(isImageWarmupEnabled({ NODE_ENV: "production" }), true);
});

test("denied page path prefixes default to an empty list", () => {
	assert.deepEqual(DEFAULT_IMAGE_OPTIONS.deniedPagePathPrefixes, []);
});

test("debounces quick requests, allows one rerun while running, and never overlaps jobs", async () => {
	let runs = 0;
	let active = 0;
	let maximumActive = 0;
	let releaseFirst;
	const firstStarted = new Promise((resolve) => { releaseFirst = resolve; });
	const scheduler = createImageWarmupScheduler({
		enabled: true,
		delayMs: 10,
		log: () => undefined,
		run: async () => {
			runs++;
			active++;
			maximumActive = Math.max(maximumActive, active);
			if (runs === 1) await firstStarted;
			active--;
		},
	});

	scheduler.schedule();
	scheduler.schedule();
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(runs, 1);
	scheduler.schedule();
	scheduler.schedule();
	releaseFirst();
	await waitFor(() => runs === 2);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(runs, 2);
	assert.equal(maximumActive, 1);
});

test("scheduler forwards its latest prefix options to the warm-up run", async () => {
	const warmupOptions = {
		deniedStorageKeyPrefixes: ["secret/"],
		deniedPagePathPrefixes: ["/members"],
	};
	let runOptions;
	let timerCallback;
	const scheduler = createImageWarmupScheduler({
		delayMs: 0,
		setTimer(callback) {
			timerCallback = callback;
			return { unref() {} };
		},
		run: async (options) => { runOptions = options; },
	});

	assert.equal(scheduler.schedule(warmupOptions), true);
	timerCallback();
	await waitFor(() => runOptions !== undefined);
	assert.deepEqual(runOptions, warmupOptions);
});

test("warm-up renders pages before variants and reports the second pass as cached", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "cache-warm-test-"));
	const cacheDirectory = path.join(directory, "image-cache");
	await mkdir(cacheDirectory);
	t.after(() => rm(directory, { recursive: true, force: true }));

	const pagePaths = new Set();
	const imageConfig = { service: { config: DEFAULT_IMAGE_OPTIONS.encoder } };
	let firstImagePageCount;
	let activeVariants = 0;
	let maximumVariants = 0;
	const server = createServer(async (request, response) => {
		const requestUrl = new URL(request.url, `http://${request.headers.host}`);
		if (requestUrl.pathname === "/sitemap.xml") {
			response.setHeader("Content-Type", "application/xml");
			response.end(`<?xml version="1.0"?><sitemapindex><sitemap><loc>http://127.0.0.1:${server.address().port}/sitemap-cases.xml</loc></sitemap></sitemapindex>`);
			return;
		}
		if (requestUrl.pathname === "/sitemap-cases.xml") {
			response.setHeader("Content-Type", "application/xml");
			response.end(`<urlset><url><loc>http://127.0.0.1:${server.address().port}/en/work/sample</loc></url></urlset>`);
			return;
		}
		if (requestUrl.pathname === "/_image") {
			firstImagePageCount ??= pagePaths.size;
			activeVariants++;
			maximumVariants = Math.max(maximumVariants, activeVariants);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const format = requestUrl.searchParams.get("f");
			const hash = createHash("sha256").update(requestUrl.href).digest("hex");
			const cachePath = imageVariantCachePath(
				cacheDirectory,
				"warm-test-media",
				hash.slice(0, 16),
				Number(requestUrl.searchParams.get("w")),
				format,
				imageConfig,
			);
			await mkdir(path.dirname(cachePath), { recursive: true });
			await writeFile(cachePath, "cached image");
			activeVariants--;
			response.setHeader("Content-Type", `image/${format}`);
			response.end("image");
			return;
		}

		pagePaths.add(requestUrl.pathname);
		const origin = `http://127.0.0.1:${server.address().port}`;
		const firstVariant = `/_image?href=${encodeURIComponent(`${origin}/_emdash/api/media/file/public.png`)}&amp;w=320&amp;f=avif`;
		const secondVariant = `/_image?href=${encodeURIComponent(`${origin}/_emdash/api/media/file/public.png`)}&amp;w=480&amp;f=webp`;
		response.setHeader("Content-Type", "text/html");
		if (requestUrl.pathname.includes("cache-warm-404")) response.statusCode = 404;
		response.end(`<picture><source srcset="${firstVariant} 320w, ${secondVariant} 480w"></picture><img srcset="${firstVariant} 320w"><img srcset="/private/link-token/media/secret?w=320&amp;f=avif 320w">`);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

	const origin = new URL(`http://127.0.0.1:${server.address().port}`);
	const firstRun = await warmPublicSite(origin, origin, { cacheDirectory });
	assert.equal(firstRun.pagesRendered, 3);
	assert.equal(firstRun.pagesRequested, 3);
	assert.equal(firstRun.variants, 2);
	assert.equal(firstRun.generated, 2);
	assert.equal(firstRun.cached, 0);
	assert.equal(firstImagePageCount, 3, "all pages should render before the first image request");
	assert.equal([...pagePaths].some((pagePath) => pagePath.startsWith("/uk")), false);
	assert.equal(maximumVariants, 1, `expected one variant request at a time, saw ${maximumVariants}`);

	pagePaths.clear();
	firstImagePageCount = undefined;
	const secondRun = await warmPublicSite(origin, origin, { cacheDirectory });
	assert.equal(secondRun.generated, 0);
	assert.equal(secondRun.cached, 2);
});

async function waitFor(predicate, timeoutMs = 1_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for background warm-up");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
