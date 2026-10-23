#!/usr/bin/env node
// Design harness CLI. Every command prints JSON on stdout; see DESIGN.md "## Harness".
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { runDesignCheck } from "./check.mjs";
import {
  catalogMarkdown,
  describeResource,
  json,
  loadHarness,
  packageRoot,
  resolveContext,
  searchDesign,
} from "./core.mjs";
import { updateFeedback } from "./feedback.mjs";
import { checkSource } from "./source-check.mjs";
import { splitFrontmatter } from "./tokens.mjs";

const usage = `Commands:
  tokens [--check]                 regenerate (or verify) DESIGN.md front-matter from tokens.css
  catalog [--check]                regenerate (or verify) design/generated/catalog.md
  resources                        list retrievable resources
  resolve SCENARIO_ID              contracts, rules, and Skills for a scenario
  search QUERY                     search resource IDs, titles, and descriptions
  check-source FILE [SCENARIO_ID]  static source rules (exit 1 on violations)
  check SCENARIO_ID [--skip-build] every rule in scope; writes test-results/design/<run>/
  feedback list | propose DRAFT.json | decide ID accepted|rejected REVIEWER REASON | apply ID`;

// Paths given on the command line are relative to where pnpm was invoked.
const cwd = process.env.INIT_CWD ?? process.cwd();
const [command, ...args] = process.argv.slice(2);

function regenerate(path, content, checking) {
  const absolute = resolve(packageRoot, path);
  if (checking) {
    let current = null;
    try {
      current = readFileSync(absolute, "utf8");
    } catch {}
    assert.equal(current === content, true, `${path} is out of date; run it without --check`);
    return { status: "pass", path };
  }
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return { status: "generated", path };
}

try {
  let harness = loadHarness();
  let result;
  switch (command) {
    case "tokens": {
      const checking = args[0] === "--check";
      const { body } = splitFrontmatter(harness.designMd);
      result = regenerate("DESIGN.md", harness.expectedFrontmatter() + body, checking);
      break;
    }
    case "catalog":
      result = regenerate(
        "design/generated/catalog.md",
        catalogMarkdown(harness),
        args[0] === "--check",
      );
      break;
    case "resources":
      result = harness.resources.map(describeResource);
      break;
    case "resolve":
      assert.equal(args.length, 1, "Usage: resolve SCENARIO_ID");
      result = resolveContext(harness, args[0]);
      break;
    case "search":
      assert(args.length >= 1, "Usage: search QUERY");
      result = searchDesign(harness, args.join(" "));
      break;
    case "check-source": {
      assert(args.length === 1 || args.length === 2, "Usage: check-source FILE [SCENARIO_ID]");
      const file = resolve(cwd, args[0]);
      result = checkSource(harness, {
        source: readFileSync(file, "utf8"),
        filename: relative(cwd, file),
        scenarioId: args[1],
      });
      process.exitCode = result.mechanicalPassed ? 0 : 1;
      break;
    }
    case "check": {
      const scenario = args.find((arg) => !arg.startsWith("--"));
      assert(scenario, "Usage: check SCENARIO_ID [--skip-build]");
      const { report, runDir } = runDesignCheck(harness, scenario, {
        skipBuild: args.includes("--skip-build"),
      });
      result = {
        mechanicalPassed: report.mechanicalPassed,
        summary: report.summary,
        report: relative(cwd, resolve(runDir, "report.md")),
        failing: report.checks
          .filter((c) => ["fail", "not-evaluated"].includes(c.status))
          .map((c) => c.rule),
        needsReview: report.checks.filter((c) => c.status === "needs-review").map((c) => c.rule),
      };
      process.exitCode = report.mechanicalPassed ? 0 : 1;
      break;
    }
    case "feedback":
      result = updateFeedback(packageRoot, args[0], args.slice(1), cwd);
      harness = loadHarness();
      break;
    default:
      throw new Error(usage);
  }
  console.log(json(result).trimEnd());
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
