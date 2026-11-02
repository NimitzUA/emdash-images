import assert from "node:assert/strict";
import test from "node:test";
import { pictureModel } from "../src/picture.mjs";

const siteUrl = new URL("https://site.example.test/blog/post/");
const image = {
	id: "primary-id",
	src: "/media/primary.jpg",
	width: 1200,
	height: 800,
	alt: "Primary image",
};

function createImageApi({ unchanged = false, sizes = "100vw" } = {}) {
	const calls = [];
	const getImage = async (options) => {
		calls.push(options);
		if (!options.widths) {
			return { src: unchanged ? options.src : `${options.src}?probe=1` };
		}

		const excludedOptions = new Set([
			"src", "width", "height", "format", "quality", "densities", "widths", "formats",
			"layout", "priority", "fit", "position", "background",
		]);
		const rest = Object.fromEntries(
			Object.entries(options).filter(([key]) => !excludedOptions.has(key)),
		);
		const attributes = {
			...rest,
			width: options.width,
			height: options.height,
			loading: rest.loading ?? "lazy",
			decoding: rest.decoding ?? "async",
		};
		if (options.layout && options.layout !== "none") {
			attributes.sizes ||= sizes;
		}
		if (options.layout && options.layout !== "none") {
			attributes["data-astro-image"] = options.layout;
		}
		if (options.priority) attributes.fetchpriority = "high";
		else if (options.fetchpriority !== undefined) attributes.fetchpriority = options.fetchpriority;

		return {
			src: `https://optimized.example.test/${options.format}/${options.width}`,
			srcSet: { attribute: `${options.format}-srcset` },
			attributes,
		};
	};
	return { calls, getImage };
}

async function render(props = {}, apiOptions = {}, contextOptions = {}) {
	const api = createImageApi(apiOptions);
	const result = await pictureModel(
		{ image, ...props },
		{
			getImage: api.getImage,
			imageConfig: contextOptions.imageConfig ?? {},
			locals: contextOptions.locals ?? {},
			url: contextOptions.url ?? siteUrl,
		},
	);
	return { ...api, result };
}

test("media URLs prefer src, then the public storage URL, then the media id", async () => {
	const direct = await render({ image: { ...image, src: "https://cdn.example.test/direct.jpg" } });
	assert.equal(direct.calls[0].src, "https://cdn.example.test/direct.jpg");

	const storageCalls = [];
	const fromStorage = await render(
		{ image: { ...image, src: undefined, meta: { storageKey: "uploads/photo.jpg" } } },
		{},
		{ locals: { emdash: { getPublicMediaUrl(key) { storageCalls.push(key); return `/public/${key}`; } } } },
	);
	assert.deepEqual(storageCalls, ["uploads/photo.jpg"]);
	assert.equal(fromStorage.calls[0].src, "https://site.example.test/public/uploads/photo.jpg");

	const fromId = await render({ image: { ...image, src: undefined, meta: { storageKey: "" } } });
	assert.equal(fromId.calls[0].src, "https://site.example.test/_emdash/api/media/file/primary-id");

	const missing = await render({ image: { id: "", meta: { storageKey: "" } } });
	assert.deepEqual(missing.result, { variants: [] });
	assert.equal(missing.calls.length, 0);
});

test("the src prop replaces the primary media URL", async () => {
	const { calls } = await render({ src: "https://cdn.example.test/override.jpg" });
	assert.equal(calls[0].src, "https://cdn.example.test/override.jpg");
});

test("an empty src prop falls back to the primary media URL", async () => {
	const { calls } = await render({ src: "" });
	assert.ok(calls.length > 0);
	assert.ok(calls.every((call) => call.src === "https://site.example.test/media/primary.jpg"));
});

test("relative URLs are absolute for pictureSources and stay relative in the fallback", async () => {
	const optimized = await render({ image: { ...image, src: "images/relative.jpg" } });
	assert.equal(optimized.calls[0].src, "https://site.example.test/blog/post/images/relative.jpg");

	const fallback = await render({ image: { ...image, src: "images/relative.jpg" } }, { unchanged: true });
	assert.equal(fallback.result.variants[0].img.src, "images/relative.jpg");
});

test("alt falls back to the media value and then to an empty string", async () => {
	const fromImage = await render({ image: { ...image, alt: "Media alt" } });
	assert.equal(fromImage.result.variants[0].img.alt, "Media alt");

	const empty = await render({ image: { ...image, alt: undefined } });
	assert.equal(empty.result.variants[0].img.alt, "");
});

test("primary and dark variants use their own content hashes", async () => {
	const { calls } = await render({
		image: {
			...image,
			darkVariant: { src: "/media/dark.jpg", width: 900, height: 600 },
		},
		contentHash: "sha1:ABCDEF0123456789ABCDEF0123456789ABCDEF01",
		darkContentHash: "sha1:0123456789ABCDEF0123456789ABCDEF01234567",
	});
	const transforms = calls.filter((call) => call.widths);
	assert.deepEqual(
		transforms.map(({ src, mediaVersion }) => [src, mediaVersion]),
		[
			["https://site.example.test/media/primary.jpg", "abcdef0123456789"],
			["https://site.example.test/media/primary.jpg", "abcdef0123456789"],
			["https://site.example.test/media/dark.jpg", "0123456789abcdef"],
			["https://site.example.test/media/dark.jpg", "0123456789abcdef"],
		],
	);
});

test("imageConfig supplies layout, fit, and position defaults", async () => {
	const { calls } = await render(
		{},
		{},
		{ imageConfig: { layout: "constrained", objectFit: "contain", objectPosition: "20% 30%" } },
	);
	const transform = calls.find((call) => call.format === "avif" && call.widths);
	assert.equal(transform.layout, "constrained");
	assert.equal(transform.fit, "contain");
	assert.equal(transform.position, "20% 30%");
});

test("constrained layout defaults format calls to cover and center", async () => {
	const { calls } = await render({ layout: "constrained" });
	const formatCalls = calls.filter((call) => call.widths);
	assert.ok(formatCalls.length > 0);
	assert.ok(formatCalls.every((call) => call.fit === "cover"));
	assert.ok(formatCalls.every((call) => call.position === "center"));
});

test("constrained layout defaults sizes on the img and both sources", async () => {
	const { result } = await render({ layout: "constrained" });
	const { img, sources } = result.variants[0];
	assert.equal(img.sizes, "100vw");
	assert.deepEqual(sources.map((source) => source.sizes), ["100vw", "100vw"]);
});

test("layout none ignores imageConfig fit and position defaults", async () => {
	const { calls } = await render(
		{ layout: "none" },
		{},
		{ imageConfig: { objectFit: "contain", objectPosition: "top" } },
	);
	const formatCalls = calls.filter((call) => call.widths);
	assert.ok(formatCalls.length > 0);
	assert.ok(formatCalls.every((call) => call.fit === "cover"));
	assert.ok(formatCalls.every((call) => call.position === undefined));
});

test("component-only props do not reach getImage as transform attributes", async () => {
	const { calls } = await render({
		image,
		darkVariant: { src: "/dark.jpg" },
		src: "/override.jpg",
		width: 700,
		height: 500,
		contentHash: "sha1:ABCDEF0123456789ABCDEF0123456789ABCDEF01",
		darkContentHash: "sha1:0123456789ABCDEF0123456789ABCDEF01234567",
		srcsetWidths: [320, 640],
		pictureAttributes: { role: "presentation" },
		class: "hero",
		style: "opacity: 1;",
		id: "hero",
		"aria-label": "hero image",
	});
	const transform = calls.find((call) => call.format === "avif" && call.widths);
	for (const key of [
		"image", "darkVariant", "contentHash", "darkContentHash", "srcsetWidths",
		"pictureAttributes", "class", "style", "id",
	]) {
		assert.equal(Object.hasOwn(transform, key), false, `${key} is component-only`);
	}
	assert.equal(transform.src, "https://site.example.test/override.jpg");
	assert.equal(transform.width, 640);
	assert.equal(transform.height, 457);
	assert.equal(transform["aria-label"], "hero image");
});

test("picture sources are ordered AVIF then WebP and carry result sizes", async () => {
	const { result } = await render({ sizes: "(max-width: 800px) 100vw, 800px" });
	const variant = result.variants[0];
	assert.deepEqual(variant.sources, [
		{ type: "image/avif", srcset: "avif-srcset", sizes: "(max-width: 800px) 100vw, 800px" },
		{ type: "image/webp", srcset: "webp-srcset", sizes: "(max-width: 800px) 100vw, 800px" },
	]);
});

test("optimized img uses service attributes and explicit component attributes", async () => {
	const { result } = await render({
		alt: "Override alt",
		class: "hero",
		id: "hero-id",
		style: "color: red;",
		layout: "constrained",
		sizes: "50vw",
	});
	assert.deepEqual(result.variants[0].img, {
		alt: "Override alt",
		width: 1080,
		height: 720,
		loading: "lazy",
		decoding: "async",
		sizes: "50vw",
		"data-astro-image": "constrained",
		src: "https://optimized.example.test/webp/1080",
		id: "hero-id",
		class: "hero",
		style: "color: red;",
	});
});

test("optimized img and sources omit sizes for layout none without a sizes prop", async () => {
	const { result } = await render({ layout: "none" });
	const { img, sources } = result.variants[0];
	assert.deepEqual(
		[Object.hasOwn(img, "sizes"), ...sources.map((source) => Object.hasOwn(source, "sizes"))],
		[false, false, false],
	);
});

test("optimized img receives forwarded title attributes", async () => {
	const { result } = await render({ title: "Optimized title" });
	assert.equal(result.variants[0].img.title, "Optimized title");
});

test("picture attributes include picture props, Astro scope props, and the scoped class", async () => {
	const { result } = await render({
		class: "hero astro-a1b2c3d4 other",
		pictureAttributes: { class: "picture-shell", role: "presentation" },
		"data-astro-cid-ab12": "",
		"data-astro-cid-cd34": true,
		"data-astro-test": "img-only",
	});
	assert.deepEqual(result.variants[0].picture, {
		class: "picture-shell astro-a1b2c3d4",
		role: "presentation",
		"data-astro-cid-ab12": "",
		"data-astro-cid-cd34": true,
	});
});

test("an unchanged probe falls back with lazy loading and priority overrides it", async () => {
	const lazy = await render(
		{ sizes: "75vw", title: "fallback title" },
		{ unchanged: true },
	);
	assert.equal(lazy.result.variants[0].picture, undefined);
	assert.deepEqual(lazy.result.variants[0].sources, []);
	assert.equal(lazy.result.variants[0].img.src, "/media/primary.jpg");
	assert.equal(lazy.result.variants[0].img.sizes, "75vw");
	assert.equal(lazy.result.variants[0].img.title, "fallback title");
	assert.equal(lazy.result.variants[0].img.loading, "lazy");
	assert.equal(lazy.result.variants[0].img.decoding, "async");

	const priority = await render(
		{ priority: true, loading: "lazy", fetchpriority: "low" },
		{ unchanged: true },
	);
	assert.equal(priority.result.variants[0].img.loading, "eager");
	assert.equal(priority.result.variants[0].img.decoding, "async");
	assert.equal(priority.result.variants[0].img.fetchpriority, "high");
});

test("focal points prepend object-position style and ignore out-of-range coordinates", async () => {
	const valid = await render({
		image: { ...image, focalX: 0.12345, focalY: 0.5 },
		style: "color: red;",
	});
	assert.equal(valid.result.variants[0].img.style, "object-position: 12.35% 50%; color: red;");

	const invalid = await render({
		image: { ...image, focalX: 1.01, focalY: 0.5 },
		style: "color: blue;",
	});
	assert.equal(invalid.result.variants[0].img.style, "color: blue;");
});

test("dark variants use paired classes, a suffixed id, and the primary alt", async () => {
	const { result } = await render({
		image: { ...image, darkVariant: { src: "/media/dark.jpg", width: 900, height: 600, alt: "Dark alt" } },
		class: "theme-image",
		id: "article-image",
	});
	assert.equal(result.variants.length, 2);
	assert.equal(result.variants[0].img.class, "emdash-image--light theme-image");
	assert.equal(result.variants[1].img.class, "emdash-image--dark theme-image");
	assert.equal(result.variants[0].img.id, "article-image");
	assert.equal(result.variants[1].img.id, "article-image--dark");
	assert.equal(result.variants[1].img.alt, "Primary image");
});

test("a dark variant without a URL is omitted and an unresolved primary renders nothing", async () => {
	const withoutDark = await render({ image: { ...image, darkVariant: { id: "", src: "" } } });
	assert.equal(withoutDark.result.variants.length, 1);
	assert.equal(withoutDark.result.variants[0].img.class, undefined);

	const unresolved = await render({ image: { id: "", src: "" } });
	assert.deepEqual(unresolved.result, { variants: [] });
});

test("blurhash placeholders render from the media field and metadata", async () => {
	const blurhash = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
	for (const imageValue of [
		{ ...image, blurhash },
		{ ...image, meta: { blurhash } },
	]) {
		const { result } = await render({ image: imageValue });
		assert.match(
			result.variants[0].img.style,
			/^background-image: url\("data:image\/bmp;base64,[A-Za-z0-9+/=]+"\); background-size: cover;$/,
		);
	}
});

test("dominant colours accept rgb and hex values", async () => {
	const rgb = await render({ image: { ...image, dominantColor: "rgb(10,20,30)" } });
	assert.equal(rgb.result.variants[0].img.style, "background-color: rgb(10,20,30);");

	const hex = await render({ image: { ...image, dominantColor: "#a1b2c3" } });
	assert.equal(hex.result.variants[0].img.style, "background-color: #a1b2c3;");

	const metadata = await render({ image: { ...image, meta: { dominantColor: "rgb(10,20,30)" } } });
	assert.equal(metadata.result.variants[0].img.style, "background-color: rgb(10,20,30);");
});

test("placeholder, focal point, and site style combine in declaration order", async () => {
	const media = { ...image, dominantColor: "rgb(10,20,30)", focalX: 0.5, focalY: 0.25 };
	const stringStyle = await render({ image: media, style: "color: red;" });
	assert.equal(
		stringStyle.result.variants[0].img.style,
		"background-color: rgb(10,20,30); object-position: 50% 25%; color: red;",
	);

	const objectStyle = await render({ image: media, style: { color: "red" } });
	assert.deepEqual(objectStyle.result.variants[0].img.style, {
		"background-color": "rgb(10,20,30)",
		"object-position": "50% 25%",
		color: "red",
	});
});

test("placeholder false disables placeholders and excludes the prop from image attributes", async () => {
	for (const unchanged of [false, true]) {
		const { calls, result } = await render(
			{ placeholder: false, image: { ...image, dominantColor: "rgb(10,20,30)" } },
			{ unchanged },
		);
		assert.equal(result.variants[0].img.style, undefined);
		assert.equal(Object.hasOwn(result.variants[0].img, "placeholder"), false);
		assert.ok(calls.length > 0);
		assert.ok(calls.every((call) => !Object.hasOwn(call, "placeholder")));
	}
});

test("dark variants use their own dominant colours", async () => {
	const { result } = await render({
		image: {
			...image,
			dominantColor: "rgb(1,2,3)",
			darkVariant: { src: "/media/dark.jpg", dominantColor: "rgb(4,5,6)" },
		},
	});
	assert.deepEqual(
		result.variants.map(({ img }) => img.style),
		["background-color: rgb(1,2,3);", "background-color: rgb(4,5,6);"],
	);
});

test("fallback img receives the dominant colour placeholder", async () => {
	const { result } = await render(
		{ image: { ...image, dominantColor: "rgb(10,20,30)" } },
		{ unchanged: true },
	);
	assert.equal(result.variants[0].img.style, "background-color: rgb(10,20,30);");
});

test("stored dominant colours cannot add CSS declarations", async (t) => {
	for (const value of [
		"red; background-image: url(https://tracker.example/x)",
		"rgb(1,2,3); color: red",
		"url(https://tracker.example/x)",
		"expression(alert(1))",
		"red",
		"#12345",
		"rgb(1,2,3)}",
		42,
	]) {
		await t.test(String(value), async () => {
			const { result } = await render({ image: { ...image, dominantColor: value } });
			assert.equal(result.variants[0].img.style, undefined);
		});
	}
});

test("invalid blurhashes do not throw and fall back to a valid dominant colour", async () => {
	for (const blurhash of ["abc", 123]) {
		const invalid = await render({ image: { ...image, blurhash } });
		assert.equal(invalid.result.variants[0].img.style, undefined);

		const fallback = await render({
			image: { ...image, blurhash, dominantColor: "rgb(10,20,30)" },
		});
		assert.equal(fallback.result.variants[0].img.style, "background-color: rgb(10,20,30);");
	}
});
