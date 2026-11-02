import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_IMAGE_OPTIONS } from "../src/options.mjs";
import { runCli } from "../src/cli.mjs";

test("config options reach commands and relative cache and uploads paths resolve against cwd", async (t) => {
	const cwd = await temporaryDirectory(t);
	const imageOptions = {
		cacheDirectory: "./image-cache",
		encoder: { avif: { quality: 42 } },
		deniedStorageKeyPrefixes: ["restricted/"],
		deniedPagePathPrefixes: ["/members"],
	};
	await writeConfig(cwd, imageOptions);
	const env = { UPLOADS_DIR: "./uploads" };
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

	assert.equal(await runCli(["backfill", "--config", "image-options.mjs", "--write"], { cwd, env, commands }), 3);
	assert.deepEqual(calls.backfill.args, ["--write"]);
	assert.deepEqual(calls.backfill.env, { UPLOADS_DIR: path.join(cwd, "uploads") });
	assert.deepEqual(calls.backfill.deniedStorageKeyPrefixes, imageOptions.deniedStorageKeyPrefixes);
	assert.deepEqual(env, { UPLOADS_DIR: "./uploads" });

	assert.equal(await runCli(["cleanup", "--config", "image-options.mjs", "--delete"], { cwd, env, commands }), 0);
	assert.deepEqual(calls.cleanup.args, ["--delete"]);
	assert.deepEqual(calls.cleanup.env, {
		UPLOADS_DIR: "./uploads",
		IMAGE_CACHE_DIR: path.join(cwd, "image-cache"),
	});
	assert.deepEqual(calls.cleanup.encoder, imageOptions.encoder);
	assert.deepEqual(calls.cleanup.deniedStorageKeyPrefixes, imageOptions.deniedStorageKeyPrefixes);
	assert.deepEqual(env, { UPLOADS_DIR: "./uploads" });

	assert.equal(await runCli(["warm", "--config", "image-options.mjs"], { cwd, env, commands }), 0);
	assert.deepEqual(calls.warm.env, env);
	assert.deepEqual(calls.warm.options, {
		cacheDirectory: path.join(cwd, "image-cache"),
		deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
		deniedPagePathPrefixes: imageOptions.deniedPagePathPrefixes,
	});
	assert.deepEqual(env, { UPLOADS_DIR: "./uploads" });
});

test("no config uses DEFAULT_IMAGE_OPTIONS and gives warm the cwd cache fallback", async () => {
	let received;
	const result = await runCli(["cleanup"], {
		env: {},
		commands: {
			cleanupImageCache: async (options) => { received = options; },
		},
	});

	assert.equal(result, 0);
	assert.deepEqual(received.env, {});
	assert.strictEqual(received.encoder, DEFAULT_IMAGE_OPTIONS.encoder);
	assert.strictEqual(received.deniedStorageKeyPrefixes, DEFAULT_IMAGE_OPTIONS.deniedStorageKeyPrefixes);

	let warmOptions;
	await runCli(["warm"], {
		env: {},
		commands: {
			warmLocalSite: async (_env, options) => {
				warmOptions = options;
				return { failures: [] };
			},
		},
	});
	assert.equal(warmOptions.cacheDirectory, path.resolve(process.cwd(), ".dev/image-cache"));
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

test("env-file cache directory reaches warm and cleanup while existing env values win", async (t) => {
	const cwd = await temporaryDirectory(t);
	await writeFile(path.join(cwd, ".env"), "FROM_FILE=file\nPRECEDENCE=file\nEMPTY_FROM_FILE=\nIMAGE_CACHE_DIR=./file-cache\n");
	const existingEnv = { PRECEDENCE: "environment", FROM_ENV: "environment" };
	let receivedEnv;
	let warmOptions;
	const result = await runCli(["warm", "--env-file", ".env"], {
		cwd,
		env: existingEnv,
		commands: {
			warmLocalSite: async (env, options) => {
				receivedEnv = env;
				warmOptions = options;
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
		IMAGE_CACHE_DIR: "./file-cache",
	});
	assert.equal(warmOptions.cacheDirectory, path.join(cwd, "file-cache"));
	assert.deepEqual(existingEnv, { PRECEDENCE: "environment", FROM_ENV: "environment" });

	let cleanupEnv;
	assert.equal(await runCli(["cleanup", "--env-file", ".env"], {
		cwd,
		env: existingEnv,
		commands: {
			cleanupImageCache: async (options) => { cleanupEnv = options.env; },
		},
	}), 0);
	assert.deepEqual(cleanupEnv, {
		FROM_FILE: "file",
		PRECEDENCE: "environment",
		EMPTY_FROM_FILE: "",
		FROM_ENV: "environment",
		IMAGE_CACHE_DIR: path.join(cwd, "file-cache"),
	});
	assert.deepEqual(existingEnv, { PRECEDENCE: "environment", FROM_ENV: "environment" });
});

test("IMAGE_CACHE_DIR takes precedence over configured cacheDirectory and resolves relative to cwd", async (t) => {
	const cwd = await temporaryDirectory(t);
	await writeConfig(cwd, { cacheDirectory: "./config-cache" });
	const env = { IMAGE_CACHE_DIR: " ./env-cache " };
	let warmOptions;
	let cleanupEnv;

	assert.equal(await runCli(["warm", "--config", "image-options.mjs"], {
		cwd,
		env,
		commands: {
			warmLocalSite: async (_commandEnv, options) => {
				warmOptions = options;
				return { failures: [] };
			},
		},
	}), 0);
	assert.equal(warmOptions.cacheDirectory, path.join(cwd, "env-cache"));
	assert.deepEqual(env, { IMAGE_CACHE_DIR: " ./env-cache " });

	assert.equal(await runCli(["cleanup", "--config", "image-options.mjs"], {
		cwd,
		env,
		commands: { cleanupImageCache: async (options) => { cleanupEnv = options.env; } },
	}), 0);
	assert.equal(cleanupEnv.IMAGE_CACHE_DIR, path.join(cwd, "env-cache"));
	assert.deepEqual(env, { IMAGE_CACHE_DIR: " ./env-cache " });
});

test("blank config cacheDirectory uses the cwd fallback and backfill resolves relative and default uploads directories", async (t) => {
	const cwd = await temporaryDirectory(t);
	await writeConfig(cwd, { cacheDirectory: "  " });
	const env = { KEEP: "value", UPLOADS_DIR: "./content" };
	let warmOptions;
	let cleanupEnv;

	assert.equal(await runCli(["warm", "--config", "image-options.mjs"], {
		cwd,
		env,
		commands: {
			warmLocalSite: async (_commandEnv, options) => {
				warmOptions = options;
				return { failures: [] };
			},
		},
	}), 0);
	assert.equal(warmOptions.cacheDirectory, path.join(cwd, ".dev/image-cache"));
	assert.deepEqual(env, { KEEP: "value", UPLOADS_DIR: "./content" });

	assert.equal(await runCli(["cleanup", "--config", "image-options.mjs"], {
		cwd,
		env,
		commands: { cleanupImageCache: async (options) => { cleanupEnv = options.env; } },
	}), 0);
	assert.deepEqual(cleanupEnv, env);
	assert.equal(Object.hasOwn(cleanupEnv, "IMAGE_CACHE_DIR"), false);
	assert.deepEqual(env, { KEEP: "value", UPLOADS_DIR: "./content" });

	let relativeUploadsEnv;
	assert.equal(await runCli(["backfill"], {
		cwd,
		env,
		commands: { backfillMediaRows: async (options) => { relativeUploadsEnv = options.env; return { exitCode: 0 }; } },
	}), 0);
	assert.equal(relativeUploadsEnv.UPLOADS_DIR, path.join(cwd, "content"));
	assert.deepEqual(env, { KEEP: "value", UPLOADS_DIR: "./content" });

	const emptyEnv = {};
	let defaultUploadsEnv;
	assert.equal(await runCli(["backfill"], {
		cwd,
		env: emptyEnv,
		commands: { backfillMediaRows: async (options) => { defaultUploadsEnv = options.env; return { exitCode: 0 }; } },
	}), 0);
	assert.equal(defaultUploadsEnv.UPLOADS_DIR, path.join(cwd, "uploads"));
	assert.deepEqual(emptyEnv, {});
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
		cacheDirectory: path.resolve(process.cwd(), ".dev/image-cache"),
		deniedStorageKeyPrefixes: DEFAULT_IMAGE_OPTIONS.deniedStorageKeyPrefixes,
		deniedPagePathPrefixes: DEFAULT_IMAGE_OPTIONS.deniedPagePathPrefixes,
	});
	let originOnlyCalls = 0;
	let originOnlyRequest;
	let originOnlyPublic;
	const originOnlyResult = await runCli(["warm", "--origin", "http://same.example"], {
		commands: {
			warmPublicSite: async (requestOrigin, publicOrigin) => {
				originOnlyCalls++;
				originOnlyRequest = requestOrigin;
				originOnlyPublic = publicOrigin;
				return { failures: [] };
			},
		},
	});
	assert.equal(originOnlyResult, 0);
	assert.equal(originOnlyCalls, 1);
	assert.equal(originOnlyRequest.href, "http://same.example/");
	assert.equal(originOnlyRequest.href, originOnlyPublic.href);
});

test("warm cache fallback resolves against the CLI cwd", async (t) => {
	const cwd = await temporaryDirectory(t);
	let warmOptions;

	assert.equal(await runCli(["warm"], {
		cwd,
		env: {},
		commands: {
			warmLocalSite: async (_env, options) => {
				warmOptions = options;
				return { failures: [] };
			},
		},
	}), 0);
	assert.equal(warmOptions.cacheDirectory, path.join(cwd, ".dev/image-cache"));
});

test("invalid public origin returns usage error without warming either site", async () => {
	let warmCalls = 0;
	const errors = [];
	const commands = {
		warmLocalSite: async () => { warmCalls++; return { failures: [] }; },
		warmPublicSite: async () => { warmCalls++; return { failures: [] }; },
	};

	assert.equal(await runCli(["warm", "--origin", "https://example.com", "--public-origin", "mailto:x@example.com"], {
		commands,
		errorLog: (message) => errors.push(message),
	}), 2);
	assert.equal(warmCalls, 0);
	assert.match(errors[0], /Option --public-origin must be an absolute http\(s\) URL\./);
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
	assert.equal(await runCli(["warm", "--public-origin", "https://example.com"], io), 2);
	assert.match(errors.at(-1), /--public-origin requires --origin/);
	assert.match(errors.at(-1), /Usage: emdash-images warm/);
	assert.match(errors.at(-1), /--public-origin <url>.*requires --origin/);
	assert.equal(await runCli(["warm", "--origin", "not-a-url"], io), 2);
	assert.match(errors.at(-1), /Option --origin must be an absolute http\(s\) URL\./);
	assert.match(errors.at(-1), /Usage: emdash-images warm/);
	assert.equal(await runCli(["warm", "--origin", "ftp://example.com"], io), 2);
	assert.match(errors.at(-1), /Option --origin must be an absolute http\(s\) URL\./);
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
