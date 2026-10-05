import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function runTypeScript(args) {
  const root = dirname(createRequire(import.meta.url).resolve("@typescript/native/package.json"));
  execFileSync(process.execPath, [join(root, "bin/tsc"), ...args], { stdio: "inherit" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runTypeScript(process.argv.slice(2));
}
