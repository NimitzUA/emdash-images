import assert from "node:assert/strict";
import test from "node:test";

let api;
let pluginModule;
let originalNodeEnv;
let originalWarmupFlag;
let originalSetTimeout;
let scheduler;
const timers = [];
const schedulerKey = Symbol.for("@nimitzua/emdash-images.image-warmup-scheduler");

test.before(async () => {
	originalNodeEnv = process.env.NODE_ENV;
	originalWarmupFlag = process.env.IMAGE_WARMUP_ON_PUBLISH;
	process.env.NODE_ENV = "production";
	delete process.env.IMAGE_WARMUP_ON_PUBLISH;
	originalSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = (callback, delay) => {
		timers.push({ callback, delay });
		return { unref() {} };
	};
	try {
		api = await import("../src/index.mjs");
		pluginModule = await import("../src/plugin.mjs");
		scheduler = globalThis[schedulerKey];
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}
});

test.after(() => {
	delete globalThis[schedulerKey];
	if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = originalNodeEnv;
	if (originalWarmupFlag === undefined) delete process.env.IMAGE_WARMUP_ON_PUBLISH;
	else process.env.IMAGE_WARMUP_ON_PUBLISH = originalWarmupFlag;
});

test("native descriptor carries serializable package options", () => {
	const options = { cacheDirectory: "/tmp/image-cache", widths: [320, 640] };
	const descriptor = api.emdashImages(options);
	assert.deepEqual(descriptor, {
		id: "emdash-images",
		version: "0.1.0",
		format: "native",
		entrypoint: "@nimitzua/emdash-images/plugin",
		capabilities: ["content:read"],
		options,
	});
	assert.doesNotThrow(() => JSON.stringify(descriptor));
});

test("native plugin exposes only after-publish and arms the real scheduler with its default debounce", async () => {
	const plugin = pluginModule.createPlugin();
	assert.deepEqual(Object.keys(plugin.hooks), ["content:afterPublish"]);
	assert.deepEqual(plugin.capabilities, ["content:read"]);
	await plugin.hooks["content:afterPublish"].handler({
		collection: "case_study",
		content: { id: "entry-1", data: {} },
	}, {});
	assert.deepEqual(timers.map((timer) => timer.delay), [5_000]);
});

test("native plugin forwards its deny lists to the warm-up scheduler", async () => {
	const warmupOptions = {
		deniedStorageKeyPrefixes: ["secret/"],
		deniedPagePathPrefixes: ["/members"],
	};
	const scheduledOptions = [];
	const schedule = scheduler.schedule;
	scheduler.schedule = (options) => scheduledOptions.push(options);
	try {
		const plugin = pluginModule.createPlugin(warmupOptions);
		await plugin.hooks["content:afterPublish"].handler({
			collection: "case_study",
			content: { id: "entry-1", data: {} },
		}, {});
		assert.deepEqual(scheduledOptions, [warmupOptions]);
	} finally {
		scheduler.schedule = schedule;
	}
});
