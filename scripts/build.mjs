import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { runTypeScript } from "./typescript.mjs";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/styles", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
// The E2E graph separately requires the full semantic typecheck before browsers
// run. Declaration generation need not repeat that same check.
runTypeScript([
  "-p",
  "tsconfig.build.json",
  ...(process.argv.includes("--no-check") ? ["--noCheck"] : []),
]);
await cp("src/styles", "dist/styles", { recursive: true });
await cp("assets", "dist/assets", { recursive: true });

await writeFile(
  "dist/styles/fonts.css",
  (await readFile("dist/styles/fonts.css", "utf8")).replaceAll("../../assets/", "../assets/"),
);
