// CONTRACT-API (design/rules.json): each design/components/*.json contract must describe the real
// package export, and its declared variants and states must render as declared.
import { readFileSync, readdirSync } from "node:fs";
import { type ComponentType, type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as UI from "./index";

type Contract = {
  id: string;
  details: {
    implementation: string;
    export: string;
    story: string;
    render: { props: Record<string, unknown>; children?: string | { component: string } };
    variants?: Record<string, { values: string[]; className: string; default?: string }>;
    states?: Record<string, { props: Record<string, unknown>; attributes: Record<string, string> }>;
  };
};

const dir = new URL("../design/components/", import.meta.url);
const contracts: Contract[] = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(new URL(file, dir), "utf8")));
const exported = UI as unknown as Record<string, ComponentType<Record<string, unknown>>>;

/** Attributes of the first `<tag>` (or the first element) in server-rendered markup. */
function attributes(html: string, tag = "[a-z][a-z0-9]*"): Record<string, string> | null {
  const open = html.match(new RegExp(`<(?:${tag})(\\s[^>]*)?>`));
  if (!open) return null;
  const attrs: Record<string, string> = {};
  for (const [, name, value] of (open[1] ?? "").matchAll(/([a-zA-Z:-]+)(?:="([^"]*)")?/g)) {
    attrs[name.toLowerCase()] = value ?? "";
  }
  return attrs;
}

function render(contract: Contract, props: Record<string, unknown> = {}): string {
  const { render: example } = contract.details;
  const children: ReactNode =
    typeof example.children === "object"
      ? createElement(exported[example.children.component])
      : example.children;
  return renderToStaticMarkup(
    createElement(exported[contract.details.export], { ...example.props, ...props }, children),
  );
}

const rootClass = (html: string) => attributes(html)?.class ?? "";

describe("CONTRACT-API", () => {
  it("has at least the pilot's component contracts", () => {
    expect(contracts.map((contract) => contract.id)).toContain("component.button");
  });
  for (const contract of contracts) {
    describe(contract.id, () => {
      it("names a real export, implementation, and story", () => {
        expect(exported[contract.details.export]).toBeTypeOf("function");
        for (const path of [contract.details.implementation, contract.details.story]) {
          expect(() => readFileSync(new URL(`../${path}`, import.meta.url))).not.toThrow();
        }
      });
      for (const [prop, variant] of Object.entries(contract.details.variants ?? {})) {
        it(`renders every declared ${prop}`, () => {
          for (const value of variant.values) {
            const className = variant.className.replace("{value}", value);
            expect(rootClass(render(contract, { [prop]: value })), `${prop}=${value}`).toContain(
              className,
            );
          }
          if (variant.default) {
            expect(rootClass(render(contract))).toContain(
              variant.className.replace("{value}", variant.default),
            );
          }
        });
      }
      for (const [state, spec] of Object.entries(contract.details.states ?? {})) {
        it(`renders the ${state} state`, () => {
          const html = render(contract, spec.props);
          // Controls are asserted on the native control; other components on their root.
          const target = attributes(html, "input|button") ?? attributes(html);
          for (const [name, value] of Object.entries(spec.attributes)) {
            expect(target?.[name], `${state}: ${name}`).toBe(value);
          }
          if (contract.id === "component.form-field" && state === "invalid") {
            const input = attributes(html, "input");
            const errorId = html.match(/<p id="([^"]+)" class="gdg-field-error"/)?.[1];
            expect(input?.["aria-invalid"]).toBe("true");
            expect(errorId && input?.["aria-describedby"]?.split(" ")).toContain(errorId);
          }
        });
      }
    });
  }
});
