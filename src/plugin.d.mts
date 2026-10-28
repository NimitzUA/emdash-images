import type { ResolvedPlugin } from "emdash";
import type { ImageWarmupOptions } from "./warmup.mjs";

export type EmdashImagesOptions = Pick<ImageWarmupOptions, "deniedStorageKeyPrefixes" | "deniedPagePathPrefixes">;
export declare function createPlugin(options?: EmdashImagesOptions): ResolvedPlugin;
export { createPlugin as default };
