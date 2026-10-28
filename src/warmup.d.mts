export interface ImageWarmupSummary {
	pagesRequested: number;
	pagesRendered: number;
	pageFailures: number;
	sitemaps: number;
	variants: number;
	generated: number;
	cached: number;
	failedVariants: number;
	failures: string[];
	elapsedMs: number;
	cacheAccountingAvailable: boolean;
}

export interface ImageWarmupEnvironment extends Record<string, string | undefined> {}
export interface ImageWarmupOptions {
	cacheDirectory?: string;
	deniedStorageKeyPrefixes?: readonly string[];
	deniedPagePathPrefixes?: readonly string[];
}
export interface ImageWarmupSchedulerOptions {
	run: (options?: ImageWarmupOptions) => unknown | Promise<unknown>;
	enabled?: boolean;
	delayMs?: number;
	log?: (message: string) => void;
	setTimer?: (callback: () => void, delayMs: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}

export declare function isImageWarmupEnabled(env?: ImageWarmupEnvironment): boolean;
export declare function createImageWarmupScheduler(options?: ImageWarmupSchedulerOptions): {
	schedule(options?: ImageWarmupOptions): boolean;
};
export declare function scheduleImageWarmup(options?: ImageWarmupOptions): void;
export declare function extractSitemapLocations(xml: string): string[];
export declare function extractImageVariantUrls(html: string, publicOrigin: URL | string, options?: ImageWarmupOptions): string[];
export declare function mapSiteUrlToRequestUrl(
	value: string | URL,
	publicOrigin: URL | string,
	requestOrigin: URL | string,
	options?: ImageWarmupOptions,
): URL | undefined;
export declare function createLocalWarmupOrigins(env?: ImageWarmupEnvironment): {
	requestOrigin: URL;
	publicOrigin: URL;
};
export declare function warmLocalSite(env?: ImageWarmupEnvironment, options?: ImageWarmupOptions): Promise<ImageWarmupSummary>;
export declare function warmPublicSite(
	requestOrigin: URL,
	publicOrigin: URL,
	options?: ImageWarmupOptions,
): Promise<ImageWarmupSummary>;
