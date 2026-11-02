import assert from "node:assert/strict";
import { getImage, imageConfig } from "astro:assets";
import { test } from "vitest";
import { pictureSources } from "../src/sources.mjs";

const src = "https://site.example.test/_emdash/api/media/file/photo.jpg";
const width = 1600;
const height = 1000;

test("pictureSources reads getImage from astro:assets when getImage is null", async () => {
	const result = await pictureSources(
		{ src, width, height },
		{ getImage: null, imageConfig },
	);

	assert.deepEqual(result?.widths, [640, 1200]);
});

test("pictureSources reads imageConfig from astro:assets when imageConfig is null", async () => {
	const result = await pictureSources(
		{ src, width, height },
		{ getImage, imageConfig: null },
	);

	assert.deepEqual(result?.widths, [640, 1200]);
});
