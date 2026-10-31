/** Values the site's Picture markup uses to build responsive public image sources. */
export interface PictureSourceInput {
	src: string;
	width?: number;
	height?: number;
	/** Missing or invalid hashes leave generated image URLs unversioned. */
	contentHash?: string;
	srcsetWidths?: readonly number[];
	/** Caller context only; transformability is determined by the getImage probe. */
	origin?: string;
	/** Additional Astro image options, except keys owned by `pictureSources`. */
	attributes?: Record<string, unknown>;
}

export interface PictureSourcesOptions {
	publicWidths?: readonly number[];
	smallWidths?: readonly number[];
	fit?: string;
	/**
	 * Image transformer; when omitted, `getImage` is read from `astro:assets`.
	 */
	getImage?: (options: any) => Promise<{
		src: string;
		srcSet: { attribute: string };
		attributes?: Record<string, unknown>;
	}>;
	/** Image config; when omitted, `imageConfig` is read from `astro:assets`. */
	imageConfig?: unknown;
}

export interface PictureSources {
	avifSrcset: string;
	webpSrcset: string;
	src: string;
	attributes: Record<string, unknown>;
	/** The hash version used in URLs, or undefined when no valid hash was supplied. */
	v: string | undefined;
	widths: number[];
}

/**
 * Builds responsive AVIF and WebP sources when the image service transforms `src`.
 * Missing or invalid hashes produce unversioned sources; undefined is returned when dimensions
 * cannot be used or the image service probe cannot transform the source.
 */
export declare function pictureSources(
	input: PictureSourceInput,
	options: PictureSourcesOptions,
): Promise<PictureSources | undefined>;
