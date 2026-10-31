import { getViteConfig } from "astro/config";
import { imageService } from "./src/options.mjs";

export default getViteConfig(
	{
		test: {
			include: ["astro-tests/**/*.render.mjs"],
			environment: "node",
		},
	},
	{
		image: {
			service: imageService({ publicWidths: [640, 1200] }),
			remotePatterns: [{ pathname: "/_emdash/api/media/file/**" }],
		},
	},
);
