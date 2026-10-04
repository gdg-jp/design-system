import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export function compilerEnvironment(node = process.execPath) {
  const runtime = JSON.parse(
    execFileSync(
      node,
      [
        "-p",
        "JSON.stringify({path:process.execPath,version:process.versions.node,arch:process.arch})",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const [major, minor] = runtime.version.split(".").map(Number);
  if (
    !Number.isInteger(major) ||
    major < 22 ||
    (major === 22 && minor < 18) ||
    realpathSync(node) !== realpathSync(runtime.path)
  ) {
    throw new Error("TypeScript requires a real Node >=22.18 executable (not a wrapper).");
  }
  return {
    GDG_UI_TSC_NODE: realpathSync(runtime.path),
    GDG_UI_TSC_RUNTIME: `${runtime.version}-${runtime.arch}`,
  };
}

export function runTypeScript(args) {
  const { GDG_UI_TSC_NODE } = compilerEnvironment(process.env.GDG_UI_TSC_NODE);
  execFileSync(
    GDG_UI_TSC_NODE,
    [createRequire(import.meta.url).resolve("typescript/bin/tsc"), ...args],
    { stdio: "inherit" },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runTypeScript(process.argv.slice(2));
}
