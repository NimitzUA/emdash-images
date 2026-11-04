import { withImageGuard } from "@nimitzua/emdash-images";
import imageOptions from "./image-options.mjs";

export const onRequest = withImageGuard((context, next) => next(), {
	deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
	onDeniedStorageKey: () => new Response("private", {
		status: 404,
		headers: {
			"Cache-Control": "no-store",
			"X-E2E-Denied": "1",
		},
	}),
});
