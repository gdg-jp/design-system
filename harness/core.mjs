// Loads the design authority (DESIGN.md, tokens.css, design/ contracts, rules, Agent Skills) into
// one validated, read-only snapshot shared by the CLI, the MCP server, and tests.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { renderFrontmatter, splitFrontmatter } from "./tokens.mjs";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));
export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const text = z.string().trim().min(1);
const id = z.string().regex(/^[a-z][a-z0-9.-]{0,99}$/);
export const skillName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const ruleId = z.string().regex(/^[A-Z][A-Z0-9-]{0,99}$/);
const names = z.array(z.string().regex(/^[A-Z][A-Za-z0-9]*$/)).min(1);

const documentSchema = z.strictObject({
  id,
  kind: z.enum(["component", "pattern", "scenario"]),
  title: text,
  description: text,
  refs: z.array(id),
  skills: z.array(skillName),
  details: z.record(z.string(), z.unknown()),
});
const componentDetails = z.looseObject({
  implementation: text,
  export: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
  story: text,
  when: text,
  render: z.strictObject({
    props: z.record(z.string(), z.unknown()),
    children: z.union([z.string(), z.strictObject({ component: text })]).optional(),
  }),
  variants: z
    .record(
      z.string(),
      z.strictObject({ values: z.array(text).min(1), className: text, default: text.optional() }),
    )
    .optional(),
  states: z
    .record(
      z.string(),
      z.strictObject({
        props: z.record(z.string(), z.unknown()),
        attributes: z.record(z.string(), z.string()),
      }),
    )
    .optional(),
});
const scenarioDetails = z.looseObject({
  artifact: z.looseObject({ source: z.array(text).min(1), story: text }),
  states: z.array(text).min(1),
  viewports: z.array(z.strictObject({ width: z.number().int(), height: z.number().int() })).min(1),
  themes: z.array(z.enum(["light", "dark"])).min(1),
});

const ruleBase = {
  id: ruleId,
  strength: z.enum(["MUST", "SHOULD"]),
  scope: z.array(id).min(1),
  requirement: text,
  source: text,
  fix: text,
};
/** Detectors that the static source checker implements; feedback proposals may only use these. */
export const sourceRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...ruleBase,
    kind: z.literal("jsx-required-prop"),
    detector: z.strictObject({ components: names, props: z.array(text).min(1) }),
  }),
  z.strictObject({
    ...ruleBase,
    kind: z.literal("jsx-requires-context"),
    detector: z.strictObject({ components: names, ancestors: names, props: z.array(text) }),
  }),
  z.strictObject({
    ...ruleBase,
    kind: z.literal("jsx-forbidden-component"),
    detector: z.strictObject({ components: names }),
  }),
  z.strictObject({
    ...ruleBase,
    kind: z.literal("jsx-literal-pattern"),
    detector: z.strictObject({ props: z.array(text).min(1), pattern: text }),
  }),
  z.strictObject({
    ...ruleBase,
    kind: z.literal("import-policy"),
    detector: z.strictObject({ forbidden: z.array(text).min(1) }),
  }),
]);
export const sourceKinds = sourceRuleSchema.options.map((option) => option.shape.kind.value);
const ruleSchema = z.union([
  sourceRuleSchema,
  z.strictObject({
    ...ruleBase,
    kind: z.enum(["generated", "contract", "browser", "review"]),
    verification: z.record(z.string(), text),
  }),
]);
export const decisionSchema = z.strictObject({
  status: z.enum(["accepted", "rejected"]),
  reviewer: text,
  reason: text,
  reviewedDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const rulesFileSchema = z.strictObject({
  version: z.literal(1),
  rules: z.array(ruleSchema),
  adoptions: z
    .array(
      z.strictObject({
        proposalId: skillName,
        proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
        ruleId,
        decision: decisionSchema,
        appliedAt: text,
      }),
    )
    .default([]),
});

export function localPath(root, path) {
  const absoluteRoot = realpathSync(root);
  const absolute = realpathSync(resolve(root, path));
  const rel = relative(absoluteRoot, absolute);
  assert(rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel), `Path escapes ${root}`);
  return absolute;
}

export function sectionId(heading) {
  return `design.${heading
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

/** Splits DESIGN.md into its `## ` sections; the front-matter becomes design.frontmatter. */
export function designSections(markdown) {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const sections = [{ id: "design.frontmatter", title: "Front-matter", body: frontmatter }];
  for (const chunk of body.split(/^(?=## )/m)) {
    const heading = chunk.match(/^## (.+)$/m)?.[1];
    if (heading) sections.push({ id: sectionId(heading), title: heading, body: chunk.trimEnd() });
  }
  return sections;
}

function readDir(root, dir) {
  return readdirSync(localPath(root, dir))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => `${dir}/${file}`);
}

export function validateRules(value, documentIds) {
  const parsed = rulesFileSchema.parse(value);
  assert.equal(
    new Set(parsed.rules.map((rule) => rule.id)).size,
    parsed.rules.length,
    "Duplicate rule ID",
  );
  for (const rule of parsed.rules) {
    for (const scope of rule.scope)
      assert(documentIds.has(scope), `${rule.id}: unknown scope ${scope}`);
    if (rule.kind === "jsx-literal-pattern") new RegExp(rule.detector.pattern);
  }
  for (const adoption of parsed.adoptions) {
    assert.equal(adoption.decision.status, "accepted", "Adoption must have an accepted decision");
  }
  return parsed;
}

export function skillsRoot(root = packageRoot) {
  return process.env.GDG_DESIGN_SKILLS_DIR ?? resolve(root, "../../.agents/skills");
}

function readSkill(dir, name) {
  const path = resolve(dir, name, "SKILL.md");
  assert(existsSync(path), `Missing Agent Skill ${name} (${path})`);
  const content = readFileSync(path, "utf8");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert(frontmatter, `Missing Skill frontmatter: ${name}`);
  assert.equal(
    frontmatter.match(/^name: (.+)$/m)?.[1]?.trim(),
    name,
    `Skill name mismatch: ${name}`,
  );
  const description = frontmatter.match(/^description: (.+)$/m)?.[1]?.trim();
  assert(description, `Missing Skill description: ${name}`);
  return { id: name, path, description, content };
}

export function loadHarness(root = packageRoot) {
  const read = (path) => readFileSync(localPath(root, path), "utf8");
  const raw = {};
  const remember = (path) => {
    raw[path] = read(path);
    return raw[path];
  };
  const designMd = remember("DESIGN.md");
  const tokensCss = remember("src/styles/tokens.css");
  const mapping = JSON.parse(remember("design/frontmatter.json"));
  const sections = designSections(designMd);
  assert(
    sections.some((section) => section.id === "design.harness"),
    "DESIGN.md needs a ## Harness section (the agent entrypoint)",
  );

  const documents = ["design/components", "design/patterns", "design/scenarios"]
    .flatMap((dir) => readDir(root, dir))
    .map((path) => {
      const doc = documentSchema.parse(JSON.parse(remember(path)));
      if (doc.kind === "component") componentDetails.parse(doc.details);
      if (doc.kind === "scenario") scenarioDetails.parse(doc.details);
      return { ...doc, path };
    });
  const ids = new Set([...sections.map((section) => section.id), "design.tokens"]);
  for (const doc of documents) {
    assert(!ids.has(doc.id), `Duplicate document ID ${doc.id}`);
    ids.add(doc.id);
  }
  for (const doc of documents) {
    for (const ref of doc.refs) assert(ids.has(ref), `${doc.id}: unknown reference ${ref}`);
  }
  const { rules, adoptions } = validateRules(JSON.parse(remember("design/rules.json")), ids);

  const skillDir = skillsRoot(root);
  const skillNames = [...new Set(documents.flatMap((doc) => doc.skills))].sort();
  const skills = existsSync(skillDir) ? skillNames.map((name) => readSkill(skillDir, name)) : null;

  // JSON contracts are hashed canonically so a formatter run is not an authority change.
  const contractRevision = digest(
    Object.entries(raw)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => {
        const canonical = path.endsWith(".json") ? json(JSON.parse(content)) : content;
        return `${path}\n${canonical}`;
      })
      .concat((skills ?? []).map((skill) => `skill:${skill.id}\n${skill.content}`))
      .join("\n"),
  );
  const resources = [
    ...sections.map((section) => ({
      id: section.id,
      kind: "design",
      title: section.title,
      description: `DESIGN.md — ${section.title}`,
      mimeType: "text/markdown",
      body: section.body,
    })),
    {
      id: "design.tokens",
      kind: "tokens",
      title: "Token source",
      description: "src/styles/tokens.css — the only hand-edited token source (light and dark).",
      mimeType: "text/css",
      body: tokensCss,
    },
    ...documents.map(({ path, ...doc }) => ({
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      description: doc.description,
      mimeType: "application/json",
      body: json(doc),
    })),
    ...rules.map((rule) => ({
      id: rule.id,
      kind: "rule",
      title: rule.id,
      description: rule.requirement,
      mimeType: "application/json",
      body: json(rule),
    })),
    ...(skills ?? []).map((skill) => ({
      id: `skill.${skill.id}`,
      kind: "skill",
      title: skill.id,
      description: skill.description,
      mimeType: "text/markdown",
      body: skill.content,
    })),
  ].map((resource) => ({ ...resource, uri: `gdg-design://${resource.id}` }));
  assert.equal(new Set(resources.map((r) => r.id)).size, resources.length, "Resource ID collision");

  return {
    root,
    designMd,
    tokensCss,
    mapping,
    sections,
    documents,
    rules,
    adoptions,
    skills,
    skillDir,
    resources,
    contractRevision,
    expectedFrontmatter: () => renderFrontmatter(tokensCss, mapping),
  };
}

export const describeResource = ({ id, kind, title, description, uri, mimeType }) => ({
  id,
  kind,
  title,
  description,
  uri,
  mimeType,
});

export function readResource(harness, uri) {
  const resource = harness.resources.find((candidate) => candidate.uri === uri);
  assert(resource, `Unknown resource: ${uri}`);
  return { uri, mimeType: resource.mimeType, text: resource.body };
}

export function searchDesign(harness, query) {
  const needle = z.string().trim().min(1).max(200).parse(query).toLowerCase();
  const terms = needle.split(/\s+/);
  const matches = harness.resources.filter((resource) => {
    const haystack = `${resource.id} ${resource.title} ${resource.description}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  return {
    contractRevision: harness.contractRevision,
    results: matches.slice(0, 20).map(describeResource),
    truncated: matches.length > 20,
  };
}

/** Resolves a scenario to its transitive contracts, the rules in scope, and its Agent Skills. */
export function resolveContext(harness, scenarioId) {
  const docs = new Map(harness.documents.map((doc) => [doc.id, doc]));
  assert.equal(docs.get(scenarioId)?.kind, "scenario", `Unknown scenario: ${scenarioId}`);
  assert(
    harness.skills,
    `Agent Skills are not installed at ${harness.skillDir}; run inside the gdgjp monorepo or set GDG_DESIGN_SKILLS_DIR`,
  );
  const selected = new Set(["design.harness", "design.dos-and-donts", "design.tokens"]);
  const skills = new Set();
  const visit = (ref) => {
    if (selected.has(ref) && ref !== "design.harness") return;
    selected.add(ref);
    const doc = docs.get(ref);
    if (!doc) return;
    for (const child of doc.refs) visit(child);
    for (const name of doc.skills) skills.add(name);
  };
  visit(scenarioId);
  const rules = harness.rules.filter((rule) => rule.scope.some((scope) => selected.has(scope)));
  for (const rule of rules) selected.add(rule.id);
  for (const name of skills) selected.add(`skill.${name}`);
  return {
    contractRevision: harness.contractRevision,
    scenarioId,
    resources: harness.resources.filter((r) => selected.has(r.id)).map(describeResource),
    rules: rules.map((rule) => ({ id: rule.id, kind: rule.kind, strength: rule.strength })),
    skills: harness.skills
      .filter((skill) => skills.has(skill.id))
      .map(({ id: name, path }) => ({ id: name, path: relative(harness.root, path) })),
  };
}

export function catalogMarkdown(harness) {
  const lines = [
    "# Design catalog",
    "",
    "Generated by `pnpm design:catalog` from DESIGN.md, src/styles/tokens.css, and design/. Do not edit.",
    "",
    "## Contracts",
    "",
    "| ID | Kind | Source | Description |",
    "| --- | --- | --- | --- |",
    ...harness.documents.map(
      (doc) =>
        `| \`${doc.id}\` | ${doc.kind} | [${doc.path}](../../${doc.path}) | ${doc.description} |`,
    ),
    "",
    "## Rules",
    "",
    "| ID | Kind | Strength | Scope | Requirement |",
    "| --- | --- | --- | --- | --- |",
    ...harness.rules.map(
      (rule) =>
        `| \`${rule.id}\` | ${rule.kind} | ${rule.strength} | ${rule.scope.join(", ")} | ${rule.requirement} |`,
    ),
    "",
    "## DESIGN.md sections",
    "",
    ...harness.sections.map((section) => `- \`${section.id}\` — ${section.title}`),
    "",
    "## Adopted feedback",
    "",
    ...(harness.adoptions.length
      ? harness.adoptions.map(
          (item) =>
            `- \`${item.proposalId}\` → \`${item.ruleId}\` (${item.decision.reviewer}: ${item.decision.reason})`,
        )
      : ["None yet."]),
    "",
  ];
  return lines.join("\n");
}
