// `pnpm design:check <scenario>`: runs every rule in the scenario's scope against the current
// working tree and writes test-results/design/<run>/report.{json,md} with the evidence.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { catalogMarkdown, digest, json, resolveContext, sourceKinds } from "./core.mjs";
import { checkSource } from "./source-check.mjs";
import { splitFrontmatter } from "./tokens.mjs";

const revisionInputs = ["src", ".storybook", "e2e", "design", "DESIGN.md", "package.json"];
const buildStamp = "build/storybook/.design-revision";

function files(root, path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute)
    .sort()
    .flatMap((name) => files(root, join(path, name)));
}

/** Content digest of everything the rendered artifact and its checks depend on. */
export function artifactRevision(root) {
  const paths = revisionInputs
    .flatMap((path) => files(root, path))
    .filter((p) => !p.includes("-snapshots/"));
  return digest(
    paths.map((path) => `${path}\n${readFileSync(resolve(root, path), "utf8")}`).join("\n"),
  );
}

function run(root, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    error: result.error,
  };
}

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const firstLines = (message, count = 4) =>
  message
    .replace(ansi, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, count)
    .join("\n");

function playwrightResults(report) {
  const tests = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        tests.push({
          title: spec.title,
          status:
            test.status === "expected" || test.status === "flaky"
              ? "pass"
              : test.status === "skipped"
                ? "skipped"
                : "fail",
          error: last?.errors?.map((error) => error.message ?? "").join("\n") ?? "",
          evidence: (test.annotations ?? [])
            .filter((a) => a.type === "evidence")
            .map((a) => a.description),
          durationMs: last?.duration ?? 0,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return tests;
}

export function runDesignCheck(harness, scenarioId, { skipBuild = false, outDir } = {}) {
  const { root } = harness;
  const context = resolveContext(harness, scenarioId);
  const scenario = harness.documents.find((doc) => doc.id === scenarioId);
  const revision = artifactRevision(root);
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const runDir =
    outDir ??
    resolve(root, "test-results/design", `${scenarioId.replace(/^scenario\./, "")}-${stamp}`);
  mkdirSync(join(runDir, "evidence"), { recursive: true });
  const rules = harness.rules.filter((rule) => context.rules.some((r) => r.id === rule.id));
  const results = new Map();
  const set = (rule, result) =>
    results.set(rule.id, { rule: rule.id, kind: rule.kind, strength: rule.strength, ...result });
  const log = [];

  // 1. Generated views: compare in memory; never rewrite.
  for (const rule of rules.filter((r) => r.kind === "generated")) {
    if (rule.verification.check === "tokens-frontmatter") {
      const actual = splitFrontmatter(harness.designMd).frontmatter;
      set(
        rule,
        actual === harness.expectedFrontmatter()
          ? { status: "pass", observation: "DESIGN.md front-matter matches tokens.css." }
          : {
              status: "fail",
              observation: "DESIGN.md front-matter differs from the tokens.css rendering.",
              nextAction: rule.fix,
            },
      );
    } else if (rule.verification.check === "catalog-view") {
      const path = resolve(root, "design/generated/catalog.md");
      const current = existsSync(path) ? readFileSync(path, "utf8") : null;
      set(
        rule,
        current === catalogMarkdown(harness)
          ? { status: "pass", observation: "design/generated/catalog.md is current." }
          : {
              status: "fail",
              observation:
                current === null
                  ? "design/generated/catalog.md is missing."
                  : "design/generated/catalog.md is stale.",
              nextAction: rule.fix,
            },
      );
    } else {
      set(rule, {
        status: "not-evaluated",
        observation: `No implementation for check ${rule.verification.check}.`,
      });
    }
  }

  // 2. Contracts against the real package API.
  const contractRules = rules.filter((r) => r.kind === "contract");
  for (const test of new Set(contractRules.map((r) => r.verification.test))) {
    const output = join(runDir, "vitest.json");
    const result = run(root, "pnpm", [
      "exec",
      "vitest",
      "run",
      test,
      "--reporter=json",
      `--outputFile=${output}`,
    ]);
    log.push(`$ vitest run ${test}\n${result.output}`);
    const report = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null;
    const failed =
      report?.testResults?.flatMap((file) =>
        file.assertionResults.filter((a) => a.status === "failed"),
      ) ?? [];
    for (const rule of contractRules.filter((r) => r.verification.test === test)) {
      set(
        rule,
        !report
          ? {
              status: "not-evaluated",
              observation: firstLines(result.output) || "Vitest did not produce a report.",
            }
          : failed.length
            ? {
                status: "fail",
                observation: failed
                  .map((a) => `${a.fullName}: ${firstLines(a.failureMessages.join("\n"), 2)}`)
                  .join("\n"),
                nextAction: rule.fix,
              }
            : {
                status: "pass",
                observation: `${report.numPassedTests} contract assertions passed (${test}).`,
              },
      );
    }
  }

  // 3. Static source rules on the scenario's artifact files.
  const sourceRules = rules.filter((r) => sourceKinds.includes(r.kind));
  const sourceFindings = scenario.details.artifact.source.map((filename) =>
    checkSource(harness, {
      source: readFileSync(resolve(root, filename), "utf8"),
      filename,
      scenarioId,
    }),
  );
  for (const rule of sourceRules) {
    const checks = sourceFindings.flatMap((f) => f.checks.filter((c) => c.rule === rule.id));
    const violations = sourceFindings.flatMap((f) =>
      f.violations.filter((v) => v.rule === rule.id),
    );
    set(rule, {
      status: violations.length
        ? "fail"
        : checks.some((c) => c.status === "pass")
          ? "pass"
          : "not-applicable",
      observation: violations.length
        ? violations.map((v) => `${v.location} ${v.observation}`).join("\n")
        : checks.map((c) => c.observation).join("\n"),
      ...(violations.length ? { nextAction: rule.fix } : {}),
    });
  }

  // 4. Browser rules: build the Storybook, run the scenario specs, map test titles to rule IDs.
  const browserRules = rules.filter((r) => r.kind === "browser");
  const specs = [...new Set(browserRules.map((r) => r.verification.test))];
  let browserError = null;
  if (specs.length) {
    if (skipBuild) {
      const built = existsSync(resolve(root, buildStamp))
        ? readFileSync(resolve(root, buildStamp), "utf8").trim()
        : null;
      if (built !== revision)
        browserError = `--skip-build: ${buildStamp} ${built ? "was built from another revision" : "is missing"}; rerun without --skip-build.`;
    } else {
      const build = run(root, "pnpm", ["build:storybook:test"]);
      log.push(`$ pnpm build:storybook:test\n${build.output.slice(-4000)}`);
      if (build.status !== 0)
        browserError = `Storybook build failed:\n${firstLines(build.output.slice(-2000), 12)}`;
      else writeFileSync(resolve(root, buildStamp), `${revision}\n`);
    }
  }
  if (specs.length && !browserError) {
    const output = join(runDir, "playwright.json");
    const result = run(root, "pnpm", ["exec", "playwright", "test", ...specs], {
      PLAYWRIGHT_JSON_OUTPUT_NAME: output,
      DESIGN_EVIDENCE_DIR: join(runDir, "evidence"),
    });
    log.push(`$ playwright test ${specs.join(" ")}\n${result.output}`);
    if (!existsSync(output))
      browserError = `Playwright produced no report:\n${firstLines(result.output, 12)}`;
    else {
      const tests = playwrightResults(JSON.parse(readFileSync(output, "utf8")));
      for (const rule of browserRules) {
        const mine = tests.filter(
          (t) => t.title.startsWith(`${rule.id}:`) && t.status !== "skipped",
        );
        const failed = mine.filter((t) => t.status === "fail");
        set(
          rule,
          !mine.length
            ? {
                status: "not-evaluated",
                observation: `No executed test titled "${rule.id}: ..." in ${rule.verification.test}.`,
              }
            : failed.length
              ? {
                  status: "fail",
                  observation: failed.map((t) => `${t.title}\n${firstLines(t.error)}`).join("\n\n"),
                  nextAction: rule.fix,
                  evidence: failed.flatMap((t) => t.evidence),
                }
              : {
                  status: "pass",
                  observation: mine.map((t) => t.title).join("\n"),
                  evidence: mine.flatMap((t) => t.evidence),
                },
        );
      }
    }
  }
  for (const rule of browserRules.filter((r) => !results.has(r.id))) {
    set(rule, {
      status: "not-evaluated",
      observation: browserError ?? "Browser checks did not run.",
    });
  }

  // 5. Contextual review stays open; attach every screenshot from this run.
  const screenshots = files(runDir, "evidence").map((path) => path);
  for (const rule of rules.filter((r) => r.kind === "review")) {
    set(rule, {
      status: screenshots.length ? "needs-review" : "not-evaluated",
      observation: screenshots.length
        ? `${screenshots.length} screenshots captured for review against the brief.`
        : "No rendered evidence was captured.",
      evidence: screenshots,
      nextAction: rule.fix,
    });
  }

  const checks = rules.map((rule) => {
    const result = results.get(rule.id);
    return {
      ...result,
      evidence: (result.evidence ?? []).map((path) => relative(runDir, resolve(runDir, path))),
    };
  });
  const blocking = checks.filter(
    (c) =>
      c.strength === "MUST" && c.kind !== "review" && ["fail", "not-evaluated"].includes(c.status),
  );
  const report = {
    scenarioId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    artifactRevision: revision,
    contractRevision: harness.contractRevision,
    git: firstLines(run(root, "git", ["rev-parse", "HEAD"]).output, 1),
    dirty: run(root, "git", ["status", "--porcelain"]).output.trim().length > 0,
    mechanicalPassed: blocking.length === 0,
    summary: Object.fromEntries(
      ["pass", "fail", "not-evaluated", "needs-review", "not-applicable"].map((s) => [
        s,
        checks.filter((c) => c.status === s).length,
      ]),
    ),
    checks,
    limits:
      "Mechanical success does not approve the design: rules of kind review stay open until a person decides. Browser checks cover the scenario's story only.",
  };
  writeFileSync(join(runDir, "report.json"), json(report));
  writeFileSync(join(runDir, "report.md"), reportMarkdown(report));
  writeFileSync(join(runDir, "commands.log"), log.join("\n\n"));
  mkdirSync(resolve(root, "test-results/design"), { recursive: true });
  writeFileSync(
    resolve(root, "test-results/design/latest.json"),
    json({ scenarioId, runDir: relative(root, runDir) }),
  );
  return { report, runDir };
}

export function reportMarkdown(report) {
  const icon = {
    pass: "PASS",
    fail: "FAIL",
    "not-evaluated": "NOT EVALUATED",
    "needs-review": "NEEDS REVIEW",
    "not-applicable": "N/A",
  };
  return [
    `# Design check: ${report.scenarioId}`,
    "",
    `- Mechanical result: **${report.mechanicalPassed ? "pass" : "fail"}**`,
    `- Artifact revision: \`${report.artifactRevision.slice(0, 12)}\` (git ${report.git.slice(0, 12)}${report.dirty ? ", dirty" : ""})`,
    `- Contract revision: \`${report.contractRevision.slice(0, 12)}\``,
    `- Summary: ${Object.entries(report.summary)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
    "",
    ...report.checks.flatMap((check) => [
      `## ${icon[check.status]} — ${check.rule} (${check.kind}, ${check.strength})`,
      "",
      "```text",
      check.observation,
      "```",
      ...(check.nextAction && check.status !== "pass" ? ["", `Next: ${check.nextAction}`] : []),
      ...(check.evidence?.length
        ? ["", ...check.evidence.map((path) => `- [${path}](${path})`)]
        : []),
      "",
    ]),
    report.limits,
    "",
  ].join("\n");
}
