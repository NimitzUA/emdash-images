import assert from "node:assert/strict";
import { experimental_AstroContainer } from "astro/container";
import { imageConfig } from "astro:assets";
import { test } from "vitest";
import Picture from "../src/Picture.astro";
import imageService from "../src/service.mjs";

const container = await experimental_AstroContainer.create();
const request = new Request("https://site.example.test/page");
const locals = {
	emdash: {
		getPublicMediaUrl(key) {
			return `/_emdash/api/media/file/${key}`;
		},
	},
};
const contentHash = "sha1:0123456789abcdef0123456789abcdef01234567";
const siteOrigin = "https://site.example.test";

function render(props) {
	return container.renderToString(Picture, { props, request, locals });
}

function countMatches(value, expression) {
	return [...value.matchAll(expression)].length;
}

function attribute(element, name) {
	const match = element.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
	return match?.[1].replaceAll("&amp;", "&");
}

function renderedImageUrls(html) {
	const srcsetUrls = [...html.matchAll(/\bsrcset="([^"]*)"/g)]
		.flatMap(([, srcset]) => srcset.replaceAll("&amp;", "&").split(","))
		.map((candidate) => candidate.trim().split(/\s+/)[0])
		.filter(Boolean);
	const imageSrcUrls = [...html.matchAll(/<img\b[^>]*>/g)]
		.map(([img]) => attribute(img, "src"))
		.filter(Boolean);
	return [...srcsetUrls, ...imageSrcUrls];
}

async function assertRenderedUrlsAcceptedByService(html) {
	const urls = renderedImageUrls(html);
	assert.ok(urls.length > 0, "expected at least one rendered image URL");
	for (const url of urls) {
		const parsed = await imageService.parseURL(new URL(url, siteOrigin), imageConfig, {});
		assert.notEqual(parsed, undefined, "image service rejected " + url);
	}
}

function assertNoPositionParameter(urls) {
	for (const url of urls) {
		assert.equal(new URL(url, siteOrigin).searchParams.has("position"), false, url + " has position");
	}
}

test("local media renders hash-versioned AVIF and WebP sources at configured widths", async () => {
	const html = await render({
		image: {
			id: "photo-id",
			width: 1600,
			height: 1000,
			alt: "Photo",
			meta: { storageKey: "photo.jpg" },
		},
		contentHash,
	});

	assert.equal(countMatches(html, /<picture\b/g), 1);
	const sources = [...html.matchAll(/<source\b[^>]*>/g)].map(([source]) => source);
	assert.equal(sources.length, 2);
	assert.match(sources[0], /type="image\/avif"/);
	assert.match(sources[1], /type="image\/webp"/);

	const avifSrcset = attribute(sources[0], "srcset");
	const webpSrcset = attribute(sources[1], "srcset");
	assert.match(avifSrcset, /\/_image\?[^\s]*f=avif/);
	assert.match(webpSrcset, /\/_image\?[^\s]*f=webp/);
	for (const srcset of [avifSrcset, webpSrcset]) {
		assert.match(srcset, /v=0123456789abcdef/);
		assert.match(srcset, /1200w/);
		assert.doesNotMatch(srcset, /1080w/);
	}

	const img = html.match(/<img\b[^>]*>/)?.[0];
	assert.ok(img);
	assert.match(attribute(img, "src"), /\/_image\?[^\s]*f=webp/);
	await assertRenderedUrlsAcceptedByService(html);
	assertNoPositionParameter(renderedImageUrls(html));
});

test("constrained layout adds Astro layout attributes to the img", async () => {
	const html = await render({
		image: { id: "photo-id", width: 1600, height: 1000, meta: { storageKey: "photo.jpg" } },
		layout: "constrained",
	});

	const img = html.match(/<img\b[^>]*>/)?.[0];
	assert.ok(img);
	assert.match(img, /data-astro-image="constrained"/);
	assert.match(img, /\bsizes="[^"]+"/);
	await assertRenderedUrlsAcceptedByService(html);
	assertNoPositionParameter(renderedImageUrls(html));
});

test("constrained fit and position stay in layout attributes, not generated URLs", async () => {
	const html = await render({
		image: { id: "photo-id", width: 1600, height: 1000, meta: { storageKey: "photo.jpg" } },
		layout: "constrained",
		fit: "contain",
		position: "top",
	});

	const img = html.match(/<img\b[^>]*>/)?.[0];
	assert.ok(img);
	assert.match(img, /data-astro-image-fit="contain"/);
	assert.match(img, /data-astro-image-pos="top"/);
	const urls = renderedImageUrls(html);
	assertNoPositionParameter(urls);
	for (const url of urls) assert.equal(new URL(url, siteOrigin).searchParams.get("fit"), "cover");
	await assertRenderedUrlsAcceptedByService(html);
});

test("full-width layout uses Astro full-width image attributes", async () => {
	const html = await render({
		image: { id: "photo-id", width: 1600, height: 1000, meta: { storageKey: "photo.jpg" } },
		layout: "full-width",
	});

	const img = html.match(/<img\b[^>]*>/)?.[0];
	assert.ok(img);
	assert.match(img, /data-astro-image="full-width"/);
	assert.equal(attribute(img, "sizes"), "100vw");
	await assertRenderedUrlsAcceptedByService(html);
	assertNoPositionParameter(renderedImageUrls(html));
});

test("top-level darkVariant prop renders separate light and dark pictures", async () => {
	const html = await render({
		image: {
			id: "light-id",
			width: 1600,
			height: 1000,
			meta: { storageKey: "light.jpg" },
		},
		darkVariant: {
			id: "dark-id",
			width: 1600,
			height: 1000,
			meta: { storageKey: "dark.jpg" },
		},
	});

	assert.equal(countMatches(html, /<picture\b/g), 2);
	assert.match(html, /class="emdash-image--light"/);
	assert.match(html, /class="emdash-image--dark"/);
});

test("dark variant renders separate light and dark pictures with suffixed ids", async () => {
	const html = await render({
		image: {
			id: "light-id",
			width: 1600,
			height: 1000,
			meta: { storageKey: "light.jpg" },
			darkVariant: {
				id: "dark-id",
				width: 1600,
				height: 1000,
				meta: { storageKey: "dark.jpg" },
			},
		},
		id: "hero",
	});

	assert.equal(countMatches(html, /<picture\b/g), 2);
	assert.match(html, /class="emdash-image--light"/);
	assert.match(html, /class="emdash-image--dark"/);
	assert.match(html, /id="hero"/);
	assert.match(html, /id="hero--dark"/);
});

test("external src falls back to a single img when Astro cannot optimize it", async () => {
	const html = await render({
		image: { id: "photo-id", width: 1600, height: 1000 },
		src: "https://cdn.example.test/photo.jpg",
	});

	assert.equal(countMatches(html, /<img\b/g), 1);
	assert.equal(countMatches(html, /<picture\b/g), 0);
	const img = html.match(/<img\b[^>]*>/)?.[0];
	assert.equal(attribute(img, "src"), "https://cdn.example.test/photo.jpg");
});

test("pictureAttributes are applied to the picture element", async () => {
	const html = await render({
		image: {
			id: "photo-id",
			width: 1600,
			height: 1000,
			meta: { storageKey: "photo.jpg" },
		},
		pictureAttributes: { class: "frame" },
	});

	const picture = html.match(/<picture\b[^>]*>/)?.[0];
	assert.match(picture, /class="frame"/);
});

test("focal point sets object-position on the img", async () => {
	const html = await render({
		image: {
			id: "photo-id",
			src: "/photo.jpg",
			width: 1600,
			height: 1000,
			focalX: 0.5,
			focalY: 0.25,
		},
	});

	const img = html.match(/<img\b[^>]*>/)?.[0];
	assert.match(img, /style="object-position: 50% 25%;?"/);
});

test("blurhash placeholder renders a background image and cover size", async () => {
	const html = await render({
		image: {
			id: "photo-id",
			src: "/photo.jpg",
			width: 1600,
			height: 1000,
			blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
		},
	});

	const img = html.match(/<img\b[^>]*>/)?.[0];
	assert.ok(img);
	assert.match(attribute(img, "style"), /background-image: url\(/);
	assert.match(attribute(img, "style"), /background-size: cover/);
});
