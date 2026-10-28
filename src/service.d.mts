export interface ImageTransform {
	src: string;
	width: number;
	height?: number;
	format?: string;
	quality?: number | string;
	position?: string;
	background?: string;
	[key: string]: unknown;
}

export interface ImageConfig {
	service?: { config?: Record<string, unknown> };
	[key: string]: unknown;
}

export interface ImageService {
	getURL?: (...args: unknown[]) => unknown;
	getHTMLAttributes?: (...args: unknown[]) => unknown;
	parseURL(url: URL, imageConfig: ImageConfig, logger?: unknown): Promise<ImageTransform | undefined>;
	getCachedVariant?(media: Record<string, unknown>, transform: ImageTransform, imageConfig: ImageConfig): Promise<unknown>;
	transform(inputBuffer: Uint8Array, transform: ImageTransform, imageConfig: ImageConfig, logger?: unknown): Promise<{ data: Uint8Array; format: string }>;
}

export declare const PUBLIC_IMAGE_ENCODER_CONFIG: {
	avif: { quality: number; effort: number; chromaSubsampling: string };
	webp: { quality: number; effort: number; smartSubsample: boolean };
};
export declare const PUBLIC_IMAGE_SMALL_WIDTHS: readonly number[];
export declare const PUBLIC_IMAGE_WIDTHS: readonly number[];
export declare const PRIVATE_IMAGE_WIDTHS: readonly number[];
export declare function createImageEncodeLimiter(limit?: number): <T>(operation: () => T | PromiseLike<T>) => Promise<Awaited<T>>;
export declare function createImageService(service?: unknown, options?: Record<string, unknown>): ImageService;
export declare function isPublicImageWidthAllowed(width: number, originalWidth: number, imageConfig?: ImageConfig): boolean;
export declare function publicResponsiveImageWidths(originalWidth: number | undefined, srcsetWidths?: readonly number[], options?: Record<string, unknown>): number[];
export declare function runWithImageCacheContext<T>(context: Record<string, unknown>, callback: () => T): T;
export declare function runWithImageEncodeLimit<T>(operation: () => T | PromiseLike<T>, limit?: number): Promise<Awaited<T>>;
export { contentHashVersion, imageCacheSettings8, imageVariantCachePath } from "./layout.mjs";

declare const imageService: ImageService;
export default imageService;
