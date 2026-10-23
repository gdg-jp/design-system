// Browser checks for design/scenarios/profile-edit.json. Each test title starts with the rule ID
// from design/rules.json; harness/check.mjs maps results back to rules by that prefix.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type Page, type TestInfo, expect, test } from "@playwright/test";

const viewports = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const themes = ["light", "dark"] as const;
const editedName = "山田 花子（GDG Tokyo）";

async function open(
  page: Page,
  { story = "default", theme = "light", manual = true } = {},
): Promise<void> {
  const args = manual ? "&args=outcome:manual" : "";
  await page.goto(
    `/iframe.html?id=patterns-profile-edit--${story}&viewMode=story&globals=theme:${theme}${args}`,
  );
  await expect(page.getByRole("heading", { level: 1, name: "プロフィール" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const nameInput = (page: Page) => page.getByRole("textbox", { name: "表示名" });
const submit = (page: Page) => page.locator('form button[type="submit"]');
const calls = (page: Page) => page.evaluate(() => window.__profileSave?.calls ?? []);
const settle = (page: Page, result: "accept" | "reject") =>
  page.evaluate((value) => window.__profileSave?.settle(value), result);

async function evidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const dir = process.env.DESIGN_EVIDENCE_DIR ?? testInfo.outputPath();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  testInfo.annotations.push({ type: "evidence", description: path });
}

// A failing check still leaves rendered evidence of the state it failed in.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const slug = testInfo.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/-$/, "");
  await evidence(page, testInfo, `failure-${slug}`);
});

/** Walks default → invalid → pending → server-error → pending → success. */
async function walk(page: Page, visit: (state: string) => Promise<void>): Promise<void> {
  await visit("default");
  await nameInput(page).fill("");
  await submit(page).click();
  await visit("invalid");
  await nameInput(page).fill(editedName);
  await submit(page).click();
  await expect(submit(page)).toHaveAttribute("aria-busy", "true");
  await visit("pending");
  await settle(page, "reject");
  await expect(page.getByRole("alert")).toBeVisible();
  await visit("server-error");
  await submit(page).click();
  await settle(page, "accept");
  await expect(page.getByRole("status").filter({ hasText: "保存しました" })).toBeVisible();
  await visit("success");
}

test("FORM-ERROR-AT-FIELD: an empty name is reported on the field and focused", async ({
  page,
}, testInfo) => {
  await open(page);
  await nameInput(page).fill("");
  await submit(page).click();
  const input = nameInput(page);
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  const describedBy = (await input.getAttribute("aria-describedby")) ?? "";
  const messages = await Promise.all(
    describedBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => page.locator(`[id="${id}"]`).innerText()),
  );
  expect(messages.join(" ")).toContain("表示名を入力してください");
  expect(await calls(page)).toEqual([]);
  await evidence(page, testInfo, "invalid-light-1280");
});

test("FORM-PENDING: repeated activation while saving sends one request", async ({
  page,
}, testInfo) => {
  await open(page);
  await nameInput(page).fill(editedName);
  await submit(page).click();
  await expect(submit(page)).toHaveAttribute("aria-busy", "true");
  await submit(page).click({ force: true });
  await nameInput(page).press("Enter");
  await nameInput(page).press("Enter");
  expect(await calls(page)).toEqual([editedName]);
  await expect(nameInput(page)).toHaveValue(editedName);
  await evidence(page, testInfo, "pending-light-1280");
  await settle(page, "accept");
  await expect(submit(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(submit(page)).toBeEnabled();
});

test("FORM-RECOVERY: a rejected save keeps the edit and retry succeeds", async ({
  page,
}, testInfo) => {
  await open(page);
  await nameInput(page).fill(editedName);
  await submit(page).click();
  await settle(page, "reject");
  await expect(page.getByRole("alert")).toContainText("保存できませんでした");
  await expect(nameInput(page)).toHaveValue(editedName);
  await expect(submit(page)).toBeEnabled();
  await evidence(page, testInfo, "server-error-light-1280");
  await submit(page).click();
  expect(await calls(page)).toEqual([editedName, editedName]);
  await settle(page, "accept");
  await expect(page.getByRole("status").filter({ hasText: "保存しました" })).toContainText(
    editedName,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await evidence(page, testInfo, "success-light-1280");
});

test("ACTION-SINGLE-PRIMARY: every state shows at most one primary button", async ({ page }) => {
  await open(page);
  await walk(page, async (state) => {
    const primary = await page.locator(".gdg-button-primary:visible").count();
    expect(primary, `${state}: visible primary buttons`).toBeLessThanOrEqual(1);
  });
});

for (const viewport of viewports) {
  for (const theme of themes) {
    test(`LAYOUT-NO-PAGE-OVERFLOW: ${theme} ${viewport.width}px states and long name fit`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const fits = async (label: string) => {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${label}: horizontal page overflow (px)`).toBeLessThanOrEqual(0);
        const box = await submit(page).boundingBox();
        expect(box, `${label}: submit button rendered`).not.toBeNull();
        expect(box ? box.x + box.width : 0, `${label}: submit right edge`).toBeLessThanOrEqual(
          viewport.width,
        );
      };
      await open(page, { theme });
      await walk(page, async (state) => {
        await fits(state);
        await evidence(page, testInfo, `${state}-${theme}-${viewport.width}`);
      });
      await open(page, { story: "long-name", theme, manual: false });
      await fits("long-name");
      await evidence(page, testInfo, `long-name-${theme}-${viewport.width}`);
    });
  }
}

for (const theme of themes) {
  test(`A11Y-AXE: ${theme} states have no WCAG A/AA violations`, async ({ page }) => {
    await open(page, { theme });
    await walk(page, async (state) => {
      if (state === "pending") return;
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        // Documented 3:1 control threshold for GDG brand action surfaces (DESIGN.md Colors).
        .exclude(".gdg-button-primary")
        .exclude(".gdg-button-secondary")
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`),
        `${theme} ${state}`,
      ).toEqual([]);
    });
  });
}

test("KEYBOARD-SUBMIT: Tab reaches the input then submit, with visible focus, and Enter saves", async ({
  page,
}) => {
  await open(page);
  const order: string[] = [];
  for (let step = 0; step < 12 && order.length < 2; step++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      const style = getComputedStyle(active);
      return {
        key:
          active.getAttribute("name") === "displayName"
            ? "input"
            : active.getAttribute("type") === "submit"
              ? "submit"
              : null,
        outline: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2,
      };
    });
    if (!focused?.key) continue;
    expect(focused.outline, `${focused.key}: visible focus outline`).toBe(true);
    order.push(focused.key);
  }
  expect(order).toEqual(["input", "submit"]);
  await nameInput(page).focus();
  await nameInput(page).fill(editedName);
  await nameInput(page).press("Enter");
  expect(await calls(page)).toEqual([editedName]);
});
