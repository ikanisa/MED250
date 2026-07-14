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

test("keeps action text readable across every MED+250 action-gradient endpoint", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const ink = "25243f";
  const actionBackgrounds = ["ff7048", "d98a9d"];

  for (const background of actionBackgrounds) {
    assert.ok(
      contrastRatio(ink, background) >= 4.5,
      `MED+250 ink must retain WCAG AA normal-text contrast on #${background}`,
    );
  }
  assert.match(
    css,
    /\.header-search button,\.network-strip>button,\.primary-wide,[\s\S]*?color:var\(--ink\);[\s\S]*?background:var\(--brand-action-gradient\);/,
  );
  assert.match(css, /\.network-strip>button \{ color:var\(--ink\); \}/);
  assert.doesNotMatch(css, /\.network-strip b,\.network-strip p,\.network-strip>button \{ color:#fff; \}/);
});
