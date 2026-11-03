import node from "@astrojs/node";
import { defineConfig } from "astro/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { emdashImages, imageService } from "@nimitzua/emdash-images";
import imageOptions from "./src/lib/image-options.mjs";

const siteDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(siteDirectory, ".data");

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		emdash({
			database: sqlite({ url: `file:${path.join(dataDirectory, "emdash.sqlite")}` }),
			storage: local({
				directory: path.join(dataDirectory, "uploads"),
				baseUrl: "/_emdash/api/media/file",
			}),
			plugins: [
				emdashImages({
					deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
					deniedPagePathPrefixes: imageOptions.deniedPagePathPrefixes,
				}),
			],
			middleware: { outer: "./src/lib/outer-middleware.mjs" },
		}),
	],
	image: {
		remotePatterns: [{ pathname: "/_emdash/api/media/file/**" }],
		service: imageService(imageOptions),
	},
});
