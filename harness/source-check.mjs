// Static TSX/JSX checks for the source-kind rules in design/rules.json. Shared by the CLI and the
// MCP server; it parses with the TypeScript compiler rather than scanning text.
import assert from "node:assert/strict";
import ts from "typescript";
import * as z from "zod";
import { digest, resolveContext, sourceKinds } from "./core.mjs";

export const sourceInput = z.strictObject({
  source: z.string().min(1).max(1_000_000),
  filename: z
    .string()
    .regex(/^[^\0]+\.(tsx|ts|jsx|js|mjs)$/, "filename must end in .tsx, .ts, .jsx, .js, or .mjs"),
  scenarioId: z.string().min(1).optional(),
});

const opening = (node) => (ts.isJsxElement(node) ? node.openingElement : node);
const tagName = (node) => opening(node).tagName.getText().split(".").at(-1);
const isJsx = (node) => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);

function attribute(node, name) {
  const attrs = opening(node).attributes.properties;
  const found = attrs.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText() === name);
  return { found, spread: attrs.some((attr) => ts.isJsxSpreadAttribute(attr)) };
}

function hasValue(attr) {
  if (!attr.initializer) return true;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text.trim().length > 0;
  const expression = attr.initializer.expression;
  if (!expression) return false;
  if (ts.isStringLiteralLike(expression)) return expression.text.trim().length > 0;
  return expression.kind !== ts.SyntaxKind.UndefinedKeyword && expression.getText() !== "undefined";
}

const templateParts = new Set([
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

function literals(node) {
  const found = [];
  const visit = (child) => {
    if (ts.isStringLiteralLike(child) || templateParts.has(child.kind) || ts.isJsxText(child))
      found.push(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

const forbiddenMatch = (specifier, forbidden) =>
  forbidden.find((entry) =>
    entry.endsWith("/")
      ? specifier.startsWith(entry)
      : specifier === entry || specifier.startsWith(`${entry}/`),
  );

/** Runs one parsed file against the given rules. */
export function inspectSource(sourceText, filename, rules) {
  const kind = filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, kind);
  const elements = [];
  const imports = [];
  const visit = (node, ancestors) => {
    if (isJsx(node)) elements.push({ node, ancestors });
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText() === "require") &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push(node.arguments[0]);
    const next = isJsx(node) ? [...ancestors, tagName(node)] : ancestors;
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(file, []);
  const at = (node) => {
    const { line, character } = file.getLineAndCharacterOfPosition(node.getStart());
    return `${filename}:${line + 1}:${character + 1}`;
  };

  const violations = [];
  const checks = rules.map((rule) => {
    const before = violations.length;
    let inspected = 0;
    let unverified = 0;
    const fail = (node, observation) =>
      violations.push({ rule: rule.id, location: at(node), observation, nextAction: rule.fix });
    if (rule.kind === "import-policy") {
      for (const specifier of imports) {
        inspected++;
        const match = forbiddenMatch(specifier.text, rule.detector.forbidden);
        if (match) fail(specifier, `Imports "${specifier.text}" (forbidden: ${match}).`);
      }
    } else {
      const targets =
        rule.kind === "jsx-literal-pattern"
          ? elements
          : elements.filter(({ node }) => rule.detector.components.includes(tagName(node)));
      const pattern =
        rule.kind === "jsx-literal-pattern" ? new RegExp(rule.detector.pattern) : null;
      for (const { node, ancestors } of targets) {
        const name = tagName(node);
        if (rule.kind === "jsx-literal-pattern") {
          for (const prop of rule.detector.props) {
            const { found } = attribute(node, prop);
            if (!found?.initializer) continue;
            inspected++;
            const hit = literals(found.initializer).find((value) => pattern.test(value));
            if (hit) fail(found, `<${name} ${prop}> contains the literal "${hit.trim()}".`);
          }
          continue;
        }
        inspected++;
        const props = rule.detector.props.map((prop) => attribute(node, prop));
        if (props.some(({ found }) => found && hasValue(found))) continue;
        if (
          rule.kind === "jsx-requires-context" &&
          ancestors.some((ancestor) => rule.detector.ancestors.includes(ancestor))
        )
          continue;
        if (props.some(({ spread }) => spread)) {
          unverified++;
          continue;
        }
        const needs =
          rule.kind === "jsx-requires-context"
            ? `${rule.detector.props.join(" or ")} or an enclosing ${rule.detector.ancestors.join("/")}`
            : `a nonempty ${rule.detector.props.join(" or ")}`;
        fail(node, `<${name}> has no ${needs}.`);
      }
    }
    const failed = violations.length > before;
    return {
      rule: rule.id,
      status: failed ? "fail" : inspected ? "pass" : "not-applicable",
      observation: `${filename}: inspected ${inspected} target(s)${unverified ? `, ${unverified} with spread props not verifiable` : ""}.`,
    };
  });
  return { violations, checks };
}

/** CLI/MCP entry: checks one source string with the source rules in scope. */
export function checkSource(harness, input) {
  const { source, filename, scenarioId } = sourceInput.parse(input);
  const inScope = scenarioId
    ? new Set(resolveContext(harness, scenarioId).rules.map((rule) => rule.id))
    : null;
  const rules = harness.rules.filter(
    (rule) => sourceKinds.includes(rule.kind) && (!inScope || inScope.has(rule.id)),
  );
  assert(rules.length, "No source rules are in scope");
  const { violations, checks } = inspectSource(source, filename, rules);
  return {
    scenarioId: scenarioId ?? null,
    filename,
    artifactRevision: digest(source),
    contractRevision: harness.contractRevision,
    mechanicalPassed: violations.length === 0,
    violations,
    checks,
    coverage: {
      automated: rules.map((rule) => rule.id),
      notAutomated: harness.rules
        .filter((rule) => !sourceKinds.includes(rule.kind) && (!inScope || inScope.has(rule.id)))
        .map((rule) => ({ rule: rule.id, kind: rule.kind, how: "pnpm design:check" })),
      limits:
        "Static syntax only: component names are matched by their JSX tag (aliased imports are not followed), spread props are not evaluated, and no rendering, CSS, layout, or interaction is examined.",
    },
  };
}
