/// <reference types="bun" />
import { chmod, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const entry = resolve("src/index.ts");
const outdir = resolve("dist");

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [entry],
  outdir,
  target: "node",
  format: "esm",
  packages: "bundle",
  sourcemap: "external",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

await writeFile(
  resolve(outdir, "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
);

await chmod(resolve(outdir, "index.js"), 0o755);

console.log(`Built src/index.ts -> dist/`);
