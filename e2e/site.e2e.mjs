import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { buildSite, prepareSiteData, startSite } from "./harness.mjs";

const serverEntry = fileURLToPath(new URL("./site/dist/server/entry.mjs", import.meta.url));
const imageCacheDirectory = fileURLToPath(new URL("./site/.data/image-cache/", import.meta.url));

test("the fixture site builds", async () => {
	await buildSite();
	await assert.doesNotReject(() => access(serverEntry));
});

describe("the fixture site serves image variants", { concurrency: false }, () => {
	let site;
	let pageHtml;
	let pageImageUrls = [];

	before(async () => {
		await prepareSiteData();
		site = await startSite();
	});

	after(async () => {
		await site?.stop();
	});

	test("a post renders AVIF and WebP sources for its hero, image block and gallery", async () => {
		const response = await fetch(`${site.origin}/posts/hello`);
		assert.equal(response.status, 200);
		pageHtml = await response.text();
		pageImageUrls = extractGeneratedImageUrls(pageHtml);

		const pictures = [...pageHtml.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi)].map(([picture]) => picture);
		assert.equal(pictures.length, 4);
		for (const picture of pictures) {
			const sources = [...picture.matchAll(/<source\b[^>]*>/gi)].map(([source]) => parseAttributes(source));
			for (const format of ["avif", "webp"]) {
				const source = sources.find((candidate) => candidate.type === `image/${format}`);
				assert.ok(source, `picture has an image/${format} source`);
				const candidates = extractSrcsetCandidates(source.srcset ?? "");
				assert.ok(candidates.length > 0, `image/${format} source has generated URLs`);
				for (const url of candidates) {
					assert.ok(url.startsWith("/_image?"), `${format} URL starts with /_image?`);
				}
			}
		}
		assert.ok(pageImageUrls.length > 0);
		for (const url of pageImageUrls) {
			assert.equal(new URL(url, site.origin).searchParams.has("v"), false, `${url} has no v= parameter`);
		}
	});

	test("every generated /_image URL serves an image", async () => {
		const imageBytes = new Map();
		for (const url of pageImageUrls) {
			const imageUrl = new URL(url, site.origin);
			const format = imageUrl.searchParams.get("f");
			assert.ok(format === "avif" || format === "webp", `URL has a supported f parameter: ${url}`);
			const response = await fetch(imageUrl);
			assert.equal(response.status, 200, `${url} is served`);
			assert.equal(response.headers.get("content-type"), `image/${format}`, `${url} has the requested content type`);
			const bytes = Buffer.from(await response.arrayBuffer());
			assert.ok(bytes.length > 0, `${url} has a non-empty body`);
			imageBytes.set(url, bytes);
		}

		const [firstUrl, firstBytes] = imageBytes.entries().next().value ?? [];
		assert.ok(firstUrl);
		const secondResponse = await fetch(new URL(firstUrl, site.origin));
		assert.equal(secondResponse.status, 200);
		assert.deepEqual(Buffer.from(await secondResponse.arrayBuffer()), firstBytes);
		assert.ok((await filesUnder(imageCacheDirectory)).length > 0);
	});

	test("a denied storage key is answered by the site's handler", async () => {
		const deniedUrl = new URL(pageImageUrls[0], site.origin);
		deniedUrl.searchParams.set("href", "/_emdash/api/media/file/restricted/private.png");
		const response = await fetch(deniedUrl);
		assert.equal(response.status, 404);
		assert.equal(response.headers.get("x-e2e-denied"), "1");
	});
});

function parseAttributes(markup) {
	return Object.fromEntries([...markup.matchAll(/(?:^|\s)([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decodeHtml(value)]));
}

function extractSrcsetUrls(srcset) {
	return extractSrcsetCandidates(srcset)
		.filter((url) => url.startsWith("/_image?"));
}

function extractSrcsetCandidates(srcset) {
	return decodeHtml(srcset)
		.split(",")
		.map((candidate) => candidate.trim().split(/\s+/, 1)[0])
		.filter(Boolean);
}

function extractGeneratedImageUrls(html) {
	const urls = new Set();
	for (const [, attribute, value] of html.matchAll(/(?:^|\s)(src|srcset)="([^"]*)"/g)) {
		if (attribute === "src") {
			const url = decodeHtml(value);
			if (url.startsWith("/_image?")) urls.add(url);
		} else {
			for (const url of extractSrcsetUrls(value)) urls.add(url);
		}
	}
	return [...urls];
}

function decodeHtml(value) {
	return value.replaceAll("&amp;", "&").replaceAll("&#38;", "&");
}

async function filesUnder(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(entries.map((entry) => {
		const entryPath = path.join(directory, entry.name);
		return entry.isDirectory() ? filesUnder(entryPath) : Promise.resolve(entry.isFile() ? [entryPath] : []);
	}));
	return nested.flat();
}
