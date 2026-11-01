import { definePlugin } from "emdash";
import { scheduleImageWarmup } from "./warmup.mjs";

const pluginId = "emdash-images";
const version = "0.2.0";

export function emdashImages(options = {}) {
	return {
		id: pluginId,
		version,
		format: "native",
		entrypoint: "@nimitzua/emdash-images/plugin",
		capabilities: ["content:read"],
		options,
	};
}

export function createPlugin(options = {}) {
	return definePlugin({
		id: pluginId,
		version,
		capabilities: ["content:read"],
		hooks: {
			"content:afterPublish": () => scheduleImageWarmup(options),
		},
	});
}

export default createPlugin;
