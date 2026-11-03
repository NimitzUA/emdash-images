import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSite } from "./harness.mjs";

const serverEntry = fileURLToPath(new URL("./site/dist/server/entry.mjs", import.meta.url));

test("the fixture site builds", async () => {
	await buildSite();
	await assert.doesNotReject(() => access(serverEntry));
});
