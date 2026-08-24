import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("routes every legacy action alias through the accessible clay action system", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--brand-action-gradient:var\(--clay-action\)/);
  assert.match(css, /color:var\(--color-white\)!important/);
  assert.match(css, /-webkit-text-fill-color:var\(--color-white\)/);
  assert.match(css, /background:var\(--clay-action\)/);
  assert.match(css, /\.product-detail-buy button/);
});

test("keeps strong actions inside the MED+250 violet palette without black backgrounds", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const actionText = "ffffff";
  assert.ok(contrastRatio(actionText, "000000") >= 4.5);
  assert.ok(contrastRatio(actionText, "7878e8") >= 3);
  assert.match(css, /--clay-action:linear-gradient\(112deg,var\(--brand-violet\) 0%,var\(--brand-violet\) 62%,var\(--brand-violet\) 100%\)/);
  assert.match(css, /--clay-action-hover:linear-gradient\(112deg,var\(--brand-violet\) 0%,var\(--brand-violet\) 62%,var\(--brand-violet\) 100%\)/);
  assert.doesNotMatch(css, /background:[^;]*(?:var\(--color-black\)|var\(--alpha-ink)/, "Black must never be used as a background or background gradient component");
});

test("keeps hexadecimal colors inside one canonical token boundary", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const start = css.indexOf("MED250_COLOR_TOKENS_START");
  const end = css.indexOf("MED250_COLOR_TOKENS_END");
  assert.ok(start >= 0 && end > start, "Canonical color-token boundary must exist");

  const hexadecimal = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/gi;
  const tokenColors = css.slice(start, end).match(hexadecimal) ?? [];
  const nonTokenColors = `${css.slice(0, start)}${css.slice(end)}`.match(hexadecimal) ?? [];

  assert.equal(nonTokenColors.length, 0, "Components must consume semantic variables instead of arbitrary hex colors");
  const approvedColors = new Set([
    "#000000",
    "#ffffff",
    "#5cdd63",
    "#ff7048",
    "#d98a9d",
    "#7878e8",
    "#f6f8ff",
    "#f0efff",
    "#f5f4ff",
    "#fff5f8",
    "#fff5f1",
    "#effaf5",
    "#f4f3fb",
    "#e8e8f0",
  ]);
  const uniqueTokenColors = new Set(tokenColors.map((color) => color.toLowerCase()));
  assert.deepEqual(uniqueTokenColors, approvedColors);
  assert.equal(uniqueTokenColors.size, 14);
  assert.doesNotMatch(css, /rgba?\(/i, "Translucent colors must use the canonical derived alpha tokens");
  assert.match(css, /--alpha-white-92:color-mix/);
  assert.match(css, /--alpha-ink-22:color-mix/);
  assert.match(css, /--alpha-violet-22:color-mix/);
});
