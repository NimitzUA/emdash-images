import type { Kysely } from "kysely";

export interface BackfillMediaRowsOptions {
	args?: string[];
	env?: Record<string, string | undefined>;
	database?: Kysely<any>;
	deniedStorageKeyPrefixes?: readonly string[];
	log?: (line: string) => void;
	errorLog?: (line: string) => void;
}

export interface BackfillMediaRowsResult extends Record<string, unknown> {
	found: number;
	missing: number;
	failed: number;
	exitCode: 0 | 3;
}

export declare function backfillMediaRows(options?: BackfillMediaRowsOptions): Promise<BackfillMediaRowsResult>;

export interface CleanupImageCacheOptions {
	args?: string[];
	env?: Record<string, string | undefined>;
	database?: Kysely<any>;
	now?: number;
	log?: (line: string) => void;
	listCacheFiles?: (cacheDirectory: string) => Promise<Array<{
		path: string;
		relativePath: string;
		size: number;
		mtimeMs: number;
	}>>;
	encoder?: Record<string, unknown>;
	deniedStorageKeyPrefixes?: readonly string[];
}

export interface CleanupImageCacheResult extends Record<string, unknown> {
	mode: "dry run" | "delete";
	deletedFiles: number;
	candidateCountBefore: number;
	candidateCountAfter: number;
}

export declare function cleanupImageCache(options?: CleanupImageCacheOptions): Promise<CleanupImageCacheResult | { mode: "help" }>;
