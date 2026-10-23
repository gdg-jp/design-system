// Self-tests for the design harness: authority integrity, detectors, drift checks, CLI/MCP
// agreement over a real stdio transport, and the feedback lifecycle in disposable copies.
// Decisions recorded in these tests are simulated inputs, not real reviews.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  catalogMarkdown,
  loadHarness,
  packageRoot,
  resolveContext,
  searchDesign,
  skillsRoot,
  sourceKinds,
} from "./core.mjs";
import { updateFeedback } from "./feedback.mjs";
import { checkSource } from "./source-check.mjs";
import { renderFrontmatter, splitFrontmatter } from "./tokens.mjs";

const hasSkills = existsSync(skillsRoot());
const cli = (args, options = {}) =>
  spawnSync(process.execPath, [join(packageRoot, "harness/cli.mjs"), ...args], {
    encoding: "utf8",
    ...options,
  });

const violating = `
import { Dialog } from "radix-ui";
import { Menu } from "lucide-react";
import * as UI from "@gdgjp/design-system";
export function Screen(props: object) {
  return (
    <UI.Stack>
      <UI.IconButton onClick={() => {}}><Menu /></UI.IconButton>
      <UI.IconButton aria-label="" />
      <UI.IconButton {...props} />
      <div style={{ color: "#ff0000" }} className="bg-[rgb(1_2_3)]" />
      <UI.RadioGroup />
    </UI.Stack>
  );
}`;
const clean = `
import * as UI from "@gdgjp/design-system";
import "@gdgjp/design-system/tokens.css";
export function Screen() {
  return (
    <UI.Stack style={{ color: "var(--gdg-muted)" }}>
      <UI.IconButton aria-label="メニューを開く" />
      <UI.FormField label="参加形式"><UI.RadioGroup /></UI.FormField>
      <UI.RadioGroup aria-labelledby="format-heading" />
    </UI.Stack>
  );
}`;

describe("authority", () => {
  const harness = loadHarness();
  it("loads with unique IDs and a stable contract revision", () => {
    expect(loadHarness().contractRevision).toBe(harness.contractRevision);
    expect(new Set(harness.resources.map((r) => r.uri)).size).toBe(harness.resources.length);
  });
  it("keeps DESIGN.md front-matter generated from tokens.css", () => {
    expect(splitFrontmatter(harness.designMd).frontmatter).toBe(harness.expectedFrontmatter());
    expect(cli(["tokens", "--check"]).status).toBe(0);
  });
  it("detects token drift without rewriting DESIGN.md", () => {
    const changed = harness.tokensCss.replace("--gdg-muted: #606060;", "--gdg-muted: #616161;");
    expect(renderFrontmatter(changed, harness.mapping)).toContain('muted: "#616161"');
    expect(renderFrontmatter(changed, harness.mapping)).not.toBe(harness.expectedFrontmatter());
    const unknown = { ...harness.mapping, colors: [...harness.mapping.colors, "nonexistent"] };
    expect(() => renderFrontmatter(harness.tokensCss, unknown)).toThrow(/--gdg-nonexistent/);
  });
  it("keeps the generated catalog current", () => {
    const current = readFileSync(join(packageRoot, "design/generated/catalog.md"), "utf8");
    expect(current).toBe(catalogMarkdown(harness));
  });
  it("has an executor for every rule and a rule for every detector", () => {
    const used = new Set(harness.rules.map((rule) => rule.kind));
    for (const kind of sourceKinds) expect(used, `detector ${kind} has no rule`).toContain(kind);
    for (const rule of harness.rules.filter((r) => r.kind === "browser")) {
      const spec = readFileSync(join(packageRoot, rule.verification.test), "utf8");
      expect(spec, `${rule.id} has no test in ${rule.verification.test}`).toMatch(
        new RegExp(`["\`]${rule.id}: `),
      );
    }
    for (const rule of harness.rules.filter((r) => r.kind === "contract")) {
      expect(existsSync(join(packageRoot, rule.verification.test))).toBe(true);
    }
    const checks = new Set(["tokens-frontmatter", "catalog-view"]);
    for (const rule of harness.rules.filter((r) => r.kind === "generated")) {
      expect(checks).toContain(rule.verification.check);
    }
  });
  it("points every scenario at existing artifact files", () => {
    for (const doc of harness.documents.filter((d) => d.kind === "scenario")) {
      for (const file of doc.details.artifact.source) {
        expect(existsSync(join(packageRoot, file)), file).toBe(true);
      }
    }
  });
  it("never serves proposals as resources", () => {
    expect(harness.resources.some((r) => r.body.includes("# Design feedback proposals"))).toBe(
      false,
    );
    expect(searchDesign(harness, "proposal").results.every((r) => r.kind !== "proposal")).toBe(
      true,
    );
  });
});

describe.skipIf(!hasSkills)("resolver", () => {
  const harness = loadHarness();
  it("resolves the pilot scenario transitively with its rules and Skills", () => {
    const context = resolveContext(harness, "scenario.profile-edit");
    const ids = context.resources.map((r) => r.id);
    for (const id of [
      "pattern.edit-form",
      "component.button",
      "component.form-field",
      "design.harness",
    ]) {
      expect(ids).toContain(id);
    }
    expect(context.rules.map((r) => r.id)).toEqual(
      expect.arrayContaining(["FORM-RECOVERY", "TOKEN-NO-RAW-COLOR"]),
    );
    expect(context.skills.map((s) => s.id)).toEqual([
      "design-build",
      "design-improve",
      "design-review",
    ]);
    for (const skill of context.skills)
      expect(existsSync(resolve(packageRoot, skill.path))).toBe(true);
  });
  it("rejects unknown scenarios instead of returning partial context", () => {
    expect(() => resolveContext(harness, "scenario.unknown")).toThrow(/Unknown scenario/);
    expect(() => resolveContext(harness, "pattern.edit-form")).toThrow(/Unknown scenario/);
  });
});

describe("source checker", () => {
  const harness = loadHarness();
  it("reports each known violation with its rule ID and location", () => {
    const result = checkSource(harness, { source: violating, filename: "fixture.tsx" });
    expect(result.mechanicalPassed).toBe(false);
    const byRule = (id) => result.violations.filter((v) => v.rule === id).length;
    expect(byRule("IMPORT-PUBLIC-API")).toBe(2);
    expect(byRule("ICON-BUTTON-NAME")).toBe(2);
    expect(byRule("TOKEN-NO-RAW-COLOR")).toBe(2);
    expect(byRule("RADIO-GROUP-NAME")).toBe(1);
    expect(result.violations[0].location).toMatch(/^fixture\.tsx:\d+:\d+$/);
    expect(result.checks.find((c) => c.rule === "ICON-BUTTON-NAME").observation).toContain(
      "1 with spread props not verifiable",
    );
  });
  it("passes the corrected neighbor cases", () => {
    const result = checkSource(harness, { source: clean, filename: "fixture.tsx" });
    expect(result.violations).toEqual([]);
  });
  it("rejects unsupported inputs", () => {
    expect(() => checkSource(harness, { source: clean, filename: "fixture.html" })).toThrow();
    expect(() => checkSource(harness, { source: "", filename: "a.tsx" })).toThrow();
  });
  it("exits 1 from the CLI on violations and 0 when clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "gdg-design-"));
    try {
      writeFileSync(join(dir, "bad.tsx"), violating);
      writeFileSync(join(dir, "good.tsx"), clean);
      const bad = cli(["check-source", join(dir, "bad.tsx")]);
      expect(bad.status).toBe(1);
      expect(JSON.parse(bad.stdout).violations.length).toBe(7);
      expect(cli(["check-source", join(dir, "good.tsx")]).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasSkills)("MCP over stdio", () => {
  let client;
  beforeAll(async () => {
    client = new Client({ name: "harness-test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(packageRoot, "harness/mcp.mjs")],
      }),
    );
  });
  afterAll(async () => client?.close());

  it("lists and reads the same resources as the loader", async () => {
    const harness = loadHarness();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(harness.resources.map((r) => r.uri).sort());
    const entry = await client.readResource({ uri: "gdg-design://design.harness" });
    expect(entry.contents[0].text).toContain("### Task sequence");
    await expect(client.readResource({ uri: "gdg-design://nope" })).rejects.toThrow();
  });
  it("returns the CLI's resolution and findings", async () => {
    const resolved = await client.callTool({
      name: "resolve_design_context",
      arguments: { scenarioId: "scenario.profile-edit" },
    });
    const viaCli = JSON.parse(cli(["resolve", "scenario.profile-edit"]).stdout);
    expect(resolved.structuredContent).toEqual(viaCli);

    const dir = mkdtempSync(join(tmpdir(), "gdg-design-"));
    try {
      writeFileSync(join(dir, "fixture.tsx"), violating);
      const checked = await client.callTool({
        name: "check_source",
        arguments: {
          source: violating,
          filename: "fixture.tsx",
          scenarioId: "scenario.profile-edit",
        },
      });
      const fromCli = JSON.parse(
        cli(["check-source", "fixture.tsx", "scenario.profile-edit"], {
          cwd: dir,
          env: { ...process.env, INIT_CWD: dir },
        }).stdout,
      );
      const strip = ({ filename, violations, ...rest }) => ({
        ...rest,
        violations: violations.map(({ location, ...v }) => ({
          ...v,
          line: location.split(":").slice(-2).join(":"),
        })),
      });
      expect(strip(checked.structuredContent)).toEqual(strip(fromCli));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("reports invalid input as a tool error", async () => {
    const result = await client.callTool({
      name: "resolve_design_context",
      arguments: { scenarioId: "nope" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("feedback lifecycle (simulated decisions in a disposable copy)", () => {
  let root;
  let evidence;
  const draft = (id, extra = {}) => ({
    id,
    observation: "A search Input was rendered without any label.",
    scope: "All screens that use Input or Textarea.",
    evidence: [evidence],
    target: "design/rules.json",
    rule: {
      id: "INPUT-LABEL-TEST",
      kind: "jsx-requires-context",
      strength: "MUST",
      scope: ["component.input"],
      requirement: "Inputs have a label.",
      source: "DESIGN.md Forms and selection",
      detector: {
        components: ["Input", "Textarea"],
        ancestors: ["FormField", "Field"],
        props: ["aria-label", "aria-labelledby"],
      },
      fix: "Wrap the input in FormField or give it aria-label.",
    },
    ...extra,
  });
  const fixture = `import * as UI from "@gdgjp/design-system";\nexport const Search = () => <UI.Input placeholder="検索" />;\n`;
  const write = (name, value) => {
    const path = join(root, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "gdg-design-feedback-"));
    for (const path of ["DESIGN.md", "design", "src/styles/tokens.css"]) {
      cpSync(join(packageRoot, path), join(root, path), { recursive: true });
    }
    rmSync(join(root, "design/proposals"), { recursive: true, force: true });
    // Start from the rules before any real adoption so the simulated lesson is new.
    const rulesPath = join(root, "design/rules.json");
    const rules = JSON.parse(readFileSync(rulesPath, "utf8"));
    const adopted = new Set((rules.adoptions ?? []).map((a) => a.ruleId));
    writeFileSync(
      rulesPath,
      JSON.stringify({
        ...rules,
        rules: rules.rules.filter((r) => !adopted.has(r.id)),
        adoptions: [],
      }),
    );
    mkdirSync(join(root, "work"));
    evidence = join(root, "work/search.tsx");
    writeFileSync(evidence, fixture);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("keeps pending and rejected proposals out of policy", () => {
    const before = loadHarness(root);
    updateFeedback(root, "propose", [write("draft-a.json", draft("input-label-a"))], root);
    expect(loadHarness(root).rules.map((r) => r.id)).not.toContain("INPUT-LABEL-TEST");
    expect(loadHarness(root).contractRevision).toBe(before.contractRevision);
    expect(
      checkSource(loadHarness(root), { source: fixture, filename: "search.tsx" }).mechanicalPassed,
    ).toBe(true);
    updateFeedback(
      root,
      "decide",
      ["input-label-a", "rejected", "simulated reviewer", "test"],
      root,
    );
    expect(() => updateFeedback(root, "apply", ["input-label-a"], root)).toThrow(/Only accepted/);
    expect(loadHarness(root).rules.map((r) => r.id)).not.toContain("INPUT-LABEL-TEST");
  });

  it("applies an accepted proposal once, and the next check detects the defect", () => {
    updateFeedback(root, "propose", [write("draft-b.json", draft("input-label-b"))], root);
    // Fixing the artifact after proposing must not change the reviewed evidence copy.
    writeFileSync(evidence, fixture.replace("<UI.Input", '<UI.Input aria-label="検索"'));
    updateFeedback(
      root,
      "decide",
      ["input-label-b", "accepted", "simulated reviewer", "test"],
      root,
    );
    const applied = updateFeedback(root, "apply", ["input-label-b"], root);
    expect(applied.status).toBe("applied");
    expect(updateFeedback(root, "apply", ["input-label-b"], root).status).toBe("already-applied");
    const harness = loadHarness(root);
    expect(harness.adoptions.map((a) => a.ruleId)).toEqual(["INPUT-LABEL-TEST"]);
    const failing = checkSource(harness, { source: fixture, filename: "search.tsx" });
    expect(failing.violations.map((v) => v.rule)).toEqual(["INPUT-LABEL-TEST"]);
    const fixed = readFileSync(evidence, "utf8");
    expect(checkSource(harness, { source: fixed, filename: "search.tsx" }).mechanicalPassed).toBe(
      true,
    );
    const wrapped = `import * as UI from "@gdgjp/design-system";\nexport const F = () => <UI.FormField label="名前"><UI.Textarea /></UI.FormField>;\n`;
    expect(checkSource(harness, { source: wrapped, filename: "f.tsx" }).mechanicalPassed).toBe(
      true,
    );
  });

  it("treats JSON reformatting as no authority change", () => {
    const before = loadHarness(root).contractRevision;
    const path = join(root, "design/patterns/edit-form.json");
    const original = readFileSync(path, "utf8");
    writeFileSync(path, JSON.stringify(JSON.parse(original)));
    expect(loadHarness(root).contractRevision).toBe(before);
    writeFileSync(path, original);
  });

  it("refuses tampered or stale proposals", () => {
    const draftC = draft("input-label-c", { rule: { ...draft("x").rule, id: "INPUT-LABEL-C" } });
    updateFeedback(root, "propose", [write("draft-c.json", draftC)], root);
    updateFeedback(
      root,
      "decide",
      ["input-label-c", "accepted", "simulated reviewer", "test"],
      root,
    );
    const path = join(root, "design/proposals/input-label-c.json");
    const proposal = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(
      path,
      JSON.stringify({ ...proposal, rule: { ...proposal.rule, strength: "SHOULD" } }),
    );
    expect(() => updateFeedback(root, "apply", ["input-label-c"], root)).toThrow(
      /changed after review/,
    );
    writeFileSync(path, JSON.stringify(proposal));
    const contract = join(root, "design/components/input.json");
    writeFileSync(contract, readFileSync(contract, "utf8").replace("Single-line", "One-line"));
    expect(() => updateFeedback(root, "apply", ["input-label-c"], root)).toThrow(
      /authority changed/,
    );
  });
});
