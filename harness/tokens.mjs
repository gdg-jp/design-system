// Reads src/styles/tokens.css (the only hand-edited token source) and renders the DESIGN.md
// front-matter from design/frontmatter.json. Checking never rewrites DESIGN.md.
import assert from "node:assert/strict";

function block(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert(start >= 0, `tokens.css has no "${selector}" block`);
  const end = css.indexOf("\n  }", start);
  return css.slice(start, end);
}

function declarations(source) {
  const values = new Map();
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of body.matchAll(/(--gdg-[a-z0-9-]+):\s*([^;]+);/g)) {
    values.set(match[1], match[2].replace(/\s+/g, " ").trim());
  }
  return values;
}

export function parseTokens(css) {
  const light = declarations(block(css, ":root,\n  .light"));
  const dark = new Map([...light, ...declarations(block(css, "  .dark").slice(2))]);
  const resolve = (theme, name, seen = []) => {
    const table = theme === "dark" ? dark : light;
    assert(table.has(name), `Unknown token ${name} (${theme})`);
    assert(!seen.includes(name), `Circular token ${[...seen, name].join(" -> ")}`);
    return table
      .get(name)
      .replace(/var\((--gdg-[a-z0-9-]+)\)/g, (_, ref) => resolve(theme, ref, [...seen, name]));
  };
  return { light, dark, resolve };
}

function value(tokens, spec, theme = "light") {
  if (typeof spec !== "string" || !spec.startsWith("--gdg-")) return spec;
  const [name, times] = spec.split("*");
  const resolved = tokens.resolve(theme, name);
  if (times === undefined) return resolved;
  const px = resolved.match(/^(\d+(?:\.\d+)?)px$/);
  assert(px, `${name} must be a px value to multiply`);
  return `${Number(px[1]) * Number(times)}px`;
}

// Matches the established DESIGN.md style: component properties are always quoted.
function scalar(input, quoted = false) {
  const text = String(input);
  if (typeof input === "number") return text;
  if (!quoted && /^-?\d+(?:\.\d+)?(?:px|em|rem|%)?$/.test(text)) return text;
  const hex = text.match(/^#[0-9a-f]{3,8}$/i);
  if (hex) return `"${text.toUpperCase()}"`;
  return text.includes('"') ? `'${text}'` : `"${text}"`;
}

export function renderFrontmatter(css, mapping) {
  const tokens = parseTokens(css);
  const lines = Object.entries(mapping.header).map(([key, text]) => `${key}: ${text}`);
  const groups = { colors: {} };
  lines.push("colors:");
  for (const key of mapping.colors) {
    const dark = key.endsWith("-dark");
    const name = key.replace(/-dark$/, "").replace(/^(?!gdg-)/, "gdg-");
    const resolved = tokens.resolve(dark ? "dark" : "light", `--${name}`);
    groups.colors[key] = resolved;
    lines.push(`  ${key}: ${scalar(resolved)}`);
  }
  for (const group of ["typography", "rounded", "spacing", "components"]) {
    groups[group] = {};
    lines.push(`${group}:`);
    for (const [key, spec] of Object.entries(mapping[group])) {
      groups[group][key] = true;
      if (typeof spec !== "object") {
        lines.push(`  ${key}: ${scalar(value(tokens, spec))}`);
        continue;
      }
      lines.push(`  ${key}:`);
      for (const [prop, propSpec] of Object.entries(spec)) {
        lines.push(`    ${prop}: ${scalar(value(tokens, propSpec), group === "components")}`);
      }
    }
  }
  for (const [, ref] of JSON.stringify(mapping.components).matchAll(/\{([a-z]+\.[a-z0-9-]+)\}/g)) {
    const [group, key] = ref.split(".");
    assert(groups[group]?.[key] !== undefined, `Component reference {${ref}} is not defined`);
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

export function splitFrontmatter(markdown) {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  assert(match, "DESIGN.md must start with a front-matter block");
  return { frontmatter: match[0], body: markdown.slice(match[0].length) };
}
