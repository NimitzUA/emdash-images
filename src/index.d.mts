import type { EmdashImagesOptions } from "./plugin.mjs";
import type { ImageWarmupOptions } from "./warmup.mjs";

export interface ImageServiceOptions {
	publicWidths: readonly number[];
	smallWidths: readonly number[];
	privateWidths: readonly number[];
	encoder: {
		avif: Record<string, unknown>;
		webp: Record<string, unknown>;
	};
	cacheDirectory?: string;
	encodeLimit: number;
	deniedStorageKeyPrefixes: readonly string[];
	deniedPagePathPrefixes: readonly string[];
}

export declare const DEFAULT_IMAGE_OPTIONS: Readonly<ImageServiceOptions>;
export declare function imageService(options?: Partial<ImageServiceOptions>): {
	entrypoint: "@nimitzua/emdash-images/service";
	config: Record<string, unknown>;
};

export interface EmdashImagesDescriptor {
	id: "emdash-images";
	version: "0.4.0";
	format: "native";
	entrypoint: "@nimitzua/emdash-images/plugin";
	capabilities: ["content:read"];
	options: EmdashImagesOptions;
}
export declare function emdashImages(options?: EmdashImagesOptions): EmdashImagesDescriptor;
export declare function scheduleImageWarmup(options?: ImageWarmupOptions): void;

export interface ImageGuardContext {
	url: URL;
	request: Request;
	locals: { emdash?: unknown };
	logger?: unknown;
}

export interface ImageGuardOptions<Context = ImageGuardContext> {
	imageService?: {
		parseURL?: (...args: unknown[]) => unknown | Promise<unknown>;
		getCachedVariant?: (...args: unknown[]) => unknown | Promise<unknown>;
	};
	imageConfig?: unknown;
	getMediaDatabase?: (emdash: unknown) => unknown | Promise<unknown>;
	deniedStorageKeyPrefixes?: readonly string[];
	onDeniedStorageKey?: (context: Context) => Response | Promise<Response>;
}

export declare function withImageGuard<Context extends ImageGuardContext = ImageGuardContext>(
	onRequest: (context: Context, next: () => Promise<Response>) => Response | Promise<Response>,
	options?: ImageGuardOptions<Context>,
): (context: Context, next: () => Promise<Response>) => Promise<Response>;

export declare function getMediaDatabase<TDatabase = unknown>(emdash: unknown): Promise<TDatabase | undefined>;

export declare function createImageEncodeLimiter(limit?: number): <T>(operation: () => T | PromiseLike<T>) => Promise<Awaited<T>>;
export declare function isPublicImageWidthAllowed(width: number, originalWidth: number, imageConfig?: unknown): boolean;
export declare function publicResponsiveImageWidths(originalWidth: number | undefined, srcsetWidths?: readonly number[], options?: Partial<ImageServiceOptions>): number[];
export declare function runWithImageCacheContext<T>(context: Record<string, unknown>, callback: () => T): T;
export declare function runWithImageEncodeLimit<T>(operation: () => T | PromiseLike<T>, limit?: number): Promise<Awaited<T>>;

export {
	pictureSources,
	type PictureSourceInput,
	type PictureSources,
	type PictureSourcesOptions,
} from "./sources.mjs";

export type { EmdashImagesOptions, ImageWarmupOptions };

export {
	contentHashVersion,
	contentHashVersion as mediaVersionFromContentHash,
	imageCacheNamespaceFromPath,
	imageCacheSettings8,
	imageVariantCachePath,
	parseImageVariantCachePath,
} from "./layout.mjs";
