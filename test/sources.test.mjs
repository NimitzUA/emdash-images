import assert from "node:assert/strict";
import test from "node:test";
import { pictureSources } from "@nimitzua/emdash-images";

const origin = "https://site.example.test";
const src = `${origin}/_emdash/api/media/file/work/photo.jpg`;
const contentHash = "sha1:ABCDEF0123456789ABCDEF0123456789ABCDEF01";
const options = {
	publicWidths: [640, 1080, 1600],
	smallWidths: [320, 480],
};

function createImageApi() {
	const calls = [];
	const getImage = async (imageOptions) => {
		calls.push(imageOptions);
		if (imageOptions.widths) {
			const version = imageOptions.mediaVersion ? `?v=${imageOptions.mediaVersion}` : "";
			const srcSet = imageOptions.widths
				.map((width) => `${imageOptions.format}-${width}${version} ${width}w`)
				.join(", ");
			return {
				src: `${imageOptions.format}-${imageOptions.width}${version}`,
				srcSet: { attribute: srcSet },
			};
		}
		return { src: `${imageOptions.src}?probe=1` };
	};
	return { calls, getImage };
}

test("pictureSources builds versioned responsive sources for a local image", async () => {
	const { calls, getImage } = createImageApi();
	const result = await pictureSources(
		{ src, width: 1200, height: 800, contentHash, origin },
		{ ...options, getImage },
	);

	assert.deepEqual(result, {
		avifSrcset: "avif-640?v=abcdef0123456789 640w, avif-1080?v=abcdef0123456789 1080w",
		webpSrcset: "webp-640?v=abcdef0123456789 640w, webp-1080?v=abcdef0123456789 1080w",
		src: "webp-1080?v=abcdef0123456789",
		attributes: {},
		v: "abcdef0123456789",
		widths: [640, 1080],
	});
	assert.ok(calls.some((call) => call.format === "avif" && call.widths?.join(",") === "640,1080"));
	assert.ok(calls.some((call) => call.format === "webp" && call.widths?.join(",") === "640,1080"));
	assert.ok(calls.filter((call) => call.widths).every((call) => call.mediaVersion === "abcdef0123456789"));
	assert.ok(calls.filter((call) => call.widths).every((call) => call.height === 720));
});

test("pictureSources uses the original width below the smallest configured width", async () => {
	const { calls, getImage } = createImageApi();
	const result = await pictureSources(
		{ src, width: 300, height: 200, contentHash, origin },
		{ ...options, getImage },
	);

	assert.deepEqual(result?.widths, [300]);
	assert.ok(calls.some((call) => call.format === "avif" && call.widths?.join(",") === "300"));
	assert.ok(calls.some((call) => call.format === "webp" && call.widths?.join(",") === "300"));
	assert.ok(calls.filter((call) => call.widths).every((call) => call.height === 200));
});

test("pictureSources builds unversioned responsive sources when the content hash is missing", async () => {
	const { calls, getImage } = createImageApi();
	const result = await pictureSources(
		{ src, width: 1200, height: 800, origin },
		{ ...options, getImage },
	);

	assert.deepEqual(result, {
		avifSrcset: "avif-640 640w, avif-1080 1080w",
		webpSrcset: "webp-640 640w, webp-1080 1080w",
		src: "webp-1080",
		attributes: {},
		v: undefined,
		widths: [640, 1080],
	});
	assert.ok(calls.filter((call) => call.widths).every((call) => !Object.hasOwn(call, "mediaVersion")));
	assert.doesNotMatch(`${result.avifSrcset} ${result.webpSrcset} ${result.src}`, /[?&]v=/);
});

test("pictureSources leaves an image untransformed when its dimensions are missing", async () => {
	const { calls, getImage } = createImageApi();
	const result = await pictureSources(
		{ src, height: 800, contentHash, origin },
		{ ...options, getImage },
	);

	assert.equal(result, undefined);
	assert.equal(calls.length, 0);
});

test("pictureSources transforms a non-local source when getImage produces a variant", async () => {
	const { calls, getImage } = createImageApi();
	const result = await pictureSources(
		{ src: "https://cdn.example.test/photo.jpg", width: 1200, height: 800, contentHash, origin },
		{ ...options, getImage },
	);

	assert.deepEqual(result, {
		avifSrcset: "avif-640?v=abcdef0123456789 640w, avif-1080?v=abcdef0123456789 1080w",
		webpSrcset: "webp-640?v=abcdef0123456789 640w, webp-1080?v=abcdef0123456789 1080w",
		src: "webp-1080?v=abcdef0123456789",
		attributes: {},
		v: "abcdef0123456789",
		widths: [640, 1080],
	});
	assert.ok(calls.some((call) => call.format === "avif" && call.widths?.join(",") === "640,1080"));
});

test("pictureSources returns undefined when getImage leaves a non-local source unchanged", async () => {
	const unchangedSource = "https://cdn.example.test/photo.jpg";
	const calls = [];
	const getImage = async (imageOptions) => {
		calls.push(imageOptions);
		return { src: unchangedSource };
	};
	const result = await pictureSources(
		{ src: unchangedSource, width: 1200, height: 800, contentHash, origin },
		{ ...options, getImage },
	);

	assert.equal(result, undefined);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].src, unchangedSource);
});

test("pictureSources uses widths from imageConfig when options do not provide them", async () => {
	const { getImage } = createImageApi();
	const result = await pictureSources(
		{ src, width: 1600, height: 1000, origin },
		{
			getImage,
			imageConfig: { service: { config: { publicWidths: [640, 1200], smallWidths: [320] } } },
		},
	);

	assert.deepEqual(result?.widths, [640, 1200]);
});

test("pictureSources uses smallWidths from imageConfig when options do not provide them", async () => {
	const { getImage } = createImageApi();
	const result = await pictureSources(
		{ src, width: 1600, height: 1000, srcsetWidths: [400], origin },
		{
			getImage,
			imageConfig: { service: { config: { publicWidths: [640, 1200], smallWidths: [400] } } },
		},
	);

	assert.deepEqual(result?.widths, [400, 640, 1200]);
});

test("pictureSources lets explicit publicWidths override imageConfig", async () => {
	const { getImage } = createImageApi();
	const result = await pictureSources(
		{ src, width: 1600, height: 1000, origin },
		{
			getImage,
			publicWidths: [640],
			imageConfig: { service: { config: { publicWidths: [640, 1200], smallWidths: [320] } } },
		},
	);

	assert.deepEqual(result?.widths, [640]);
});

test("pictureSources uses default publicWidths when options and imageConfig have none", async () => {
	const { getImage } = createImageApi();
	const result = await pictureSources(
		{ src, width: 2000, height: 1250, origin },
		{ getImage },
	);

	assert.deepEqual(result?.widths, [640, 1080, 1600, 1920]);
});

test("pictureSources forwards attributes only to format calls and returns WebP attributes", async () => {
	const calls = [];
	const webpAttributes = { sizes: "100vw", "data-astro-image": "constrained" };
	const getImage = async (imageOptions) => {
		calls.push(imageOptions);
		if (!imageOptions.widths) return { src: `${imageOptions.src}?probe=1` };
		const srcSet = imageOptions.widths
			.map((candidateWidth) => `${imageOptions.format}-${candidateWidth} ${candidateWidth}w`)
			.join(", ");
		return {
			src: `${imageOptions.format}-${imageOptions.width}`,
			srcSet: { attribute: srcSet },
			attributes: imageOptions.format === "webp" ? webpAttributes : { sizes: "avif-only" },
		};
	};
	const attributes = {
		class: "image-frame",
		sizes: "(max-width: 1200px) 100vw, 1200px",
		fit: "contain",
		src: "forged.jpg",
		width: 1,
		height: 2,
		widths: [1],
		densities: [2],
		format: "jpeg",
		mediaVersion: "forged",
	};
	const result = await pictureSources(
		{ src, width: 1200, height: 800, contentHash, origin, attributes },
		{ ...options, getImage },
	);

	const probe = calls.find((call) => !call.widths);
	const formatCalls = calls.filter((call) => call.widths);
	assert.equal(formatCalls.length, 2);
	assert.equal(probe.src, src);
	assert.equal(Object.hasOwn(probe, "class"), false);
	assert.equal(Object.hasOwn(probe, "sizes"), false);
	assert.deepEqual(formatCalls.map((call) => call.format).sort(), ["avif", "webp"]);
	for (const call of formatCalls) {
		assert.equal(call.class, "image-frame");
		assert.equal(call.sizes, attributes.sizes);
		assert.equal(call.fit, "contain");
		assert.equal(call.src, src);
		assert.equal(call.width, 1080);
		assert.equal(call.height, 720);
		assert.deepEqual(call.widths, [640, 1080]);
		assert.equal(call.mediaVersion, "abcdef0123456789");
		assert.equal(Object.hasOwn(call, "densities"), false);
	}
	assert.deepEqual(result.attributes, webpAttributes);
});

test("pictureSources prefers options.fit over attributes.fit", async () => {
	const { calls, getImage } = createImageApi();
	await pictureSources(
		{ src, width: 1200, height: 800, origin, attributes: { fit: "contain" } },
		{ ...options, getImage, fit: "cover" },
	);

	assert.ok(calls.filter((call) => call.widths).every((call) => call.fit === "cover"));
});

test("pictureSources rejects when getImage is unavailable", async () => {
	await assert.rejects(
		pictureSources({ src, width: 1200, height: 800 }),
		/requires a getImage function/,
	);
});
