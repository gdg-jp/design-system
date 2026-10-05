import { expect, test } from "@playwright/test";

test("headerless shell keeps footer controls visible on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto("/iframe.html?id=components-appshell--sidebar-footer&viewMode=story");
  const sidebar = page.locator(".gdg-shell > .gdg-sidebar-component");
  const theme = sidebar.getByRole("button", { name: "配色" });
  await expect(theme).toBeVisible();
  await expect(page.locator(".gdg-shell-header")).toBeHidden();
  await expect(sidebar.locator(".gdg-sidebar-trigger")).toHaveCount(0);
  const box = await theme.boundingBox();
  expect(box?.y).toBeGreaterThan(600);
  await theme.click();
  await page.getByRole("menuitemradio", { name: "ダーク" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(theme).toBeFocused();

  await page.setViewportSize({ width: 390, height: 700 });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "ナビゲーション", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "配色" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "ナビゲーション", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("compact controls honor height, rows and icon sizes without overflowing", async ({ page }) => {
  await page.goto("http://127.0.0.1:6017/tailwind.html");
  await expect(page.getByLabel("Compact input")).toHaveCSS("height", "32px");
  await expect(page.getByLabel("Compact selection")).toHaveCSS("height", "32px");
  await expect(page.getByLabel("Two lines")).toHaveAttribute("rows", "2");
  const textarea = await page.getByLabel("Two lines").boundingBox();
  expect(textarea?.height).toBeLessThan(80);
  const iconButton = page.getByRole("button", { name: "Compact icon" });
  await expect(iconButton).toHaveCSS("width", "32px");
  await expect(iconButton).toHaveCSS("height", "32px");
  await expect(iconButton.locator("svg")).toHaveCSS("width", "12px");
  await expect(page.getByTestId("sized-icon").locator("svg")).toHaveCSS("width", "18px");
  await expect(page.getByLabel("Destination URL")).toHaveCSS("width", "256px");
  const label = await page.getByText("Destination URL", { exact: true }).boundingBox();
  const destination = await page.getByLabel("Destination URL").boundingBox();
  expect(destination?.y).toBeGreaterThan((label?.y ?? 0) + (label?.height ?? 0));
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveClass("dark");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.getByLabel("Compact input")).toHaveCSS("border-top-style", "solid");
});
