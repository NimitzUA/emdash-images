import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_IMAGE_OPTIONS } from "../src/options.mjs";
import { runCli } from "../src/cli.mjs";

test("config options reach backfill, cleanup, and warm commands", async (t) => {
	const cwd = await temporaryDirectory(t);
	const imageOptions = {
		cacheDirectory: "./image-cache",
		encoder: { avif: { quality: 42 } },
		deniedStorageKeyPrefixes: ["restricted/"],
		deniedPagePathPrefixes: ["/members"],
	};
	await writeConfig(cwd, imageOptions);
	const calls = {};
	const commands = {
		backfillMediaRows: async (options) => {
			calls.backfill = options;
			return { exitCode: 3 };
		},
		cleanupImageCache: async (options) => { calls.cleanup = options; },
		warmLocalSite: async (env, options) => {
			calls.warm = { env, options };
			return { failures: [] };
		},
	};

	assert.equal(await runCli(["backfill", "--config", "image-options.mjs", "--write"], { cwd, commands }), 3);
	assert.deepEqual(calls.backfill.args, ["--write"]);
	assert.deepEqual(calls.backfill.deniedStorageKeyPrefixes, imageOptions.deniedStorageKeyPrefixes);

	assert.equal(await runCli(["cleanup", "--config", "image-options.mjs", "--delete"], { cwd, commands }), 0);
	assert.deepEqual(calls.cleanup.args, ["--delete"]);
	assert.deepEqual(calls.cleanup.encoder, imageOptions.encoder);
	assert.deepEqual(calls.cleanup.deniedStorageKeyPrefixes, imageOptions.deniedStorageKeyPrefixes);

	assert.equal(await runCli(["warm", "--config", "image-options.mjs"], { cwd, commands }), 0);
	assert.deepEqual(calls.warm.options, {
		cacheDirectory: imageOptions.cacheDirectory,
		deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
		deniedPagePathPrefixes: imageOptions.deniedPagePathPrefixes,
	});
});

test("no config uses DEFAULT_IMAGE_OPTIONS and leaves an unset cacheDirectory out of warm options", async () => {
	let received;
	const result = await runCli(["cleanup"], {
		commands: {
			cleanupImageCache: async (options) => { received = options; },
		},
	});

	assert.equal(result, 0);
	assert.strictEqual(received.encoder, DEFAULT_IMAGE_OPTIONS.encoder);
	assert.strictEqual(received.deniedStorageKeyPrefixes, DEFAULT_IMAGE_OPTIONS.deniedStorageKeyPrefixes);

	let warmOptions;
	await runCli(["warm"], {
		commands: {
			warmLocalSite: async (_env, options) => {
				warmOptions = options;
				return { failures: [] };
			},
		},
	});
	assert.equal(Object.hasOwn(warmOptions, "cacheDirectory"), false);
});

test("a config without a default plain object returns a runtime error", async (t) => {
	const cwd = await temporaryDirectory(t);
	await writeFile(path.join(cwd, "bad-options.mjs"), "export const options = {};\n");
	const errors = [];
	const result = await runCli(["backfill", "--config", "bad-options.mjs"], {
		cwd,
		errorLog: (message) => errors.push(message),
		commands: { backfillMediaRows: async () => ({ exitCode: 0 }) },
	});

	assert.equal(result, 1);
	assert.match(errors[0], /bad-options\.mjs/);
	assert.match(errors[0], /plain object/);
});

test("env-file values reach commands while existing env values win", async (t) => {
	const cwd = await temporaryDirectory(t);
	await writeFile(path.join(cwd, ".env"), "FROM_FILE=file\nPRECEDENCE=file\nEMPTY_FROM_FILE=\n");
	const existingEnv = { PRECEDENCE: "environment", FROM_ENV: "environment" };
	let receivedEnv;
	const result = await runCli(["warm", "--env-file", ".env"], {
		cwd,
		env: existingEnv,
		commands: {
			warmLocalSite: async (env) => {
				receivedEnv = env;
				return { failures: [] };
			},
		},
	});

	assert.equal(result, 0);
	assert.deepEqual(receivedEnv, {
		FROM_FILE: "file",
		PRECEDENCE: "environment",
		EMPTY_FROM_FILE: "",
		FROM_ENV: "environment",
	});
	assert.deepEqual(existingEnv, { PRECEDENCE: "environment", FROM_ENV: "environment" });
});

test("warm reports failures and chooses local or public site by origin options", async () => {
	let localCall;
	let publicCall;
	const commands = {
		warmLocalSite: async (env, options) => {
			localCall = { env, options };
			return { failures: ["page failed"] };
		},
		warmPublicSite: async (requestOrigin, publicOrigin, options) => {
			publicCall = { requestOrigin, publicOrigin, options };
			return { failures: [] };
		},
	};

	assert.equal(await runCli(["warm"], { env: { PORT: "4321" }, commands }), 1);
	assert.deepEqual(localCall.env, { PORT: "4321" });
	assert.equal(await runCli(["warm", "--origin", "http://request.example", "--public-origin", "https://public.example"], { commands }), 0);
	assert.equal(publicCall.requestOrigin.href, "http://request.example/");
	assert.equal(publicCall.publicOrigin.href, "https://public.example/");
	assert.deepEqual(publicCall.options, {
		deniedStorageKeyPrefixes: DEFAULT_IMAGE_OPTIONS.deniedStorageKeyPrefixes,
		deniedPagePathPrefixes: DEFAULT_IMAGE_OPTIONS.deniedPagePathPrefixes,
	});
	await runCli(["warm", "--origin", "http://same.example"], {
		commands: {
			warmPublicSite: async (requestOrigin, publicOrigin) => {
				assert.equal(requestOrigin.href, "http://same.example/");
				assert.equal(publicOrigin.href, "http://same.example/");
				return { failures: [] };
			},
		},
	});
});

test("help and usage errors return the documented exit codes", async () => {
	const logged = [];
	const errors = [];
	const io = { log: (message) => logged.push(message), errorLog: (message) => errors.push(message) };

	assert.equal(await runCli(["frobnicate"], io), 2);
	assert.match(errors.at(-1), /Usage: emdash-images/);
	assert.equal(await runCli(["backfill", "--mystery"], io), 2);
	assert.match(errors.at(-1), /Usage: emdash-images backfill/);
	assert.equal(await runCli(["warm", "--origin"], io), 2);
	assert.match(errors.at(-1), /Usage: emdash-images warm/);
	assert.equal(await runCli(["backfill", "--help"], io), 0);
	assert.match(logged.at(-1), /Usage: emdash-images backfill/);
});

test("general help succeeds while no command returns usage error", async () => {
	const logged = [];
	const errors = [];
	const io = { log: (message) => logged.push(message), errorLog: (message) => errors.push(message) };

	assert.equal(await runCli(["--help"], io), 0);
	assert.match(logged[0], /warm/);
	assert.match(logged[0], /backfill/);
	assert.match(logged[0], /cleanup/);
	assert.match(logged[0], /--config/);
	assert.match(logged[0], /--env-file/);
	assert.equal(await runCli([], io), 2);
	assert.match(errors[0], /Usage: emdash-images/);
});

async function temporaryDirectory(t) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "emdash-images-cli-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

async function writeConfig(directory, options) {
	await writeFile(path.join(directory, "image-options.mjs"), `export default ${JSON.stringify(options)};\n`);
}
