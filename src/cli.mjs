import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { backfillMediaRows, cleanupImageCache } from "./maintenance.mjs";
import { DEFAULT_IMAGE_OPTIONS } from "./options.mjs";
import { warmLocalSite, warmPublicSite } from "./warmup.mjs";

const DEFAULT_COMMANDS = { backfillMediaRows, cleanupImageCache, warmLocalSite, warmPublicSite };
const GLOBAL_OPTIONS = {
	config: { type: "string" },
	"env-file": { type: "string" },
	help: { type: "boolean", short: "h" },
};
const COMMAND_OPTIONS = {
	backfill: { write: { type: "boolean" } },
	cleanup: { delete: { type: "boolean" } },
	warm: {
		origin: { type: "string" },
		"public-origin": { type: "string" },
	},
};

const GENERAL_USAGE = `Usage: emdash-images <command> [options]

Commands:
  backfill [--write]
  cleanup [--delete]
  warm [--origin <url>] [--public-origin <url>]

Global options:
  --config <path>      Load image options from a module
  --env-file <path>    Load environment variables from a file
  -h, --help           Show help`;

const COMMAND_USAGE = {
	backfill: `Usage: emdash-images backfill [--config <path>] [--env-file <path>] [--write]

Options:
  --write              Write missing media metadata (default: dry run)
  --config <path>      Load image options from a module
  --env-file <path>    Load environment variables from a file
  -h, --help           Show help`,
	cleanup: `Usage: emdash-images cleanup [--config <path>] [--env-file <path>] [--delete]

Options:
  --delete             Delete eligible cache files (default: dry run)
  --config <path>      Load image options from a module
  --env-file <path>    Load environment variables from a file
  -h, --help           Show help`,
	warm: `Usage: emdash-images warm [--config <path>] [--env-file <path>] [--origin <url>] [--public-origin <url>]

Options:
  --origin <url>         Request origin; without it, warm the local site
  --public-origin <url>  Public origin (requires --origin; defaults to --origin)
  --config <path>        Load image options from a module
  --env-file <path>      Load environment variables from a file
  -h, --help             Show help`,
};

export async function runCli(argv, {
	env = process.env,
	cwd = process.cwd(),
	log = console.log,
	errorLog = console.error,
	commands,
} = {}) {
	const args = Array.isArray(argv) ? argv : [];
	if ((args[0] === "--help" || args[0] === "-h") && args.length === 1) {
		log(GENERAL_USAGE);
		return 0;
	}

	const command = args[0];
	if (!Object.hasOwn(COMMAND_OPTIONS, command)) {
		errorLog(GENERAL_USAGE);
		return 2;
	}

	let parsed;
	try {
		parsed = parseArgs({
			args: args.slice(1),
			options: { ...GLOBAL_OPTIONS, ...COMMAND_OPTIONS[command] },
			allowPositionals: false,
			strict: true,
		});
	} catch (error) {
		errorLog(`${errorMessage(error)}\n\n${COMMAND_USAGE[command]}`);
		return 2;
	}

	if (parsed.values.help) {
		log(COMMAND_USAGE[command]);
		return 0;
	}

	for (const name of ["config", "env-file", "origin", "public-origin"]) {
		if (parsed.values[name] === "") {
			errorLog(`Option --${name} requires a value.\n\n${COMMAND_USAGE[command]}`);
			return 2;
		}
	}
	if (parsed.values["public-origin"] !== undefined && parsed.values.origin === undefined) {
		errorLog(`Option --public-origin requires --origin.\n\n${COMMAND_USAGE.warm}`);
		return 2;
	}

	let requestOrigin;
	let publicOrigin;
	for (const [name, value] of [["origin", parsed.values.origin], ["public-origin", parsed.values["public-origin"]]]) {
		if (value === undefined) continue;
		try {
			const url = new URL(value);
			if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError();
			if (name === "origin") requestOrigin = url;
			else publicOrigin = url;
		} catch {
			errorLog(`Option --${name} must be an absolute http(s) URL.\n\n${COMMAND_USAGE.warm}`);
			return 2;
		}
	}

	try {
		let imageOptions = DEFAULT_IMAGE_OPTIONS;
		if (parsed.values.config !== undefined) {
			const configPath = path.resolve(cwd, parsed.values.config);
			const configModule = await import(pathToFileURL(configPath).href);
			if (!isPlainObject(configModule.default)) {
				throw new TypeError(`Config ${configPath} must default-export a plain object of image options.`);
			}
			imageOptions = configModule.default;
		}

		let commandEnv = env;
		if (parsed.values["env-file"] !== undefined) {
			const envFilePath = path.resolve(cwd, parsed.values["env-file"]);
			const fileEnv = parseEnv(await readFile(envFilePath, "utf8"));
			const existingEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
			commandEnv = { ...fileEnv, ...existingEnv };
		}

		const selectedCommands = { ...DEFAULT_COMMANDS, ...commands };
		if (command === "backfill") {
			const backfillEnv = {
				...commandEnv,
				UPLOADS_DIR: path.resolve(cwd, nonBlankString(commandEnv.UPLOADS_DIR) ?? "uploads"),
			};
			const result = await selectedCommands.backfillMediaRows({
				args: parsed.values.write ? ["--write"] : [],
				env: backfillEnv,
				deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
			});
			return result.exitCode;
		}

		if (command === "cleanup") {
			const cacheDirectory = resolveCacheDirectory(commandEnv, imageOptions, cwd);
			const cleanupEnv = cacheDirectory === undefined
				? commandEnv
				: { ...commandEnv, IMAGE_CACHE_DIR: cacheDirectory };
			await selectedCommands.cleanupImageCache({
				args: parsed.values.delete ? ["--delete"] : [],
				env: cleanupEnv,
				encoder: imageOptions.encoder,
				deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
			});
			return 0;
		}

		const cacheDirectory = resolveCacheDirectory(commandEnv, imageOptions, cwd)
			?? path.resolve(cwd, ".dev/image-cache");
		const warmOptions = {
			cacheDirectory,
			deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
			deniedPagePathPrefixes: imageOptions.deniedPagePathPrefixes,
		};
		const summary = requestOrigin === undefined
			? await selectedCommands.warmLocalSite(commandEnv, warmOptions)
			: await selectedCommands.warmPublicSite(
				requestOrigin,
				publicOrigin ?? requestOrigin,
				warmOptions,
			);
		return summary.failures?.length ? 1 : 0;
	} catch (error) {
		errorLog(errorMessage(error));
		return 1;
	}
}

function resolveCacheDirectory(commandEnv, imageOptions, cwd) {
	const value = nonBlankString(commandEnv.IMAGE_CACHE_DIR) ?? nonBlankString(imageOptions.cacheDirectory);
	return value === undefined ? undefined : path.resolve(cwd, value);
}

function nonBlankString(value) {
	if (typeof value !== "string") return undefined;
	return value.trim() || undefined;
}

function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
