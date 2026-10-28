export interface ParsedImageVariantCachePath {
	namespace: string;
	settings8: string;
	mediaId: string;
	hash16: string;
	width: number;
	format: "avif" | "webp";
}

export declare function imageVariantCachePath(cacheDirectory: string, mediaId: string, hash16: string, width: number, format: string, imageConfig: unknown): string;
export declare function imageCacheSettings8(imageConfig: unknown): string;
export declare function contentHashVersion(contentHash: unknown): string | undefined;
export declare function imageCacheNamespaceFromPath(cacheDirectory: string, candidatePath: string): string | undefined;
export declare function parseImageVariantCachePath(cacheDirectory: string, candidatePath: string): ParsedImageVariantCachePath | undefined;
