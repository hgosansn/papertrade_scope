import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHART_THEME_VARIABLES } from "../src/lib/chart-theme.js";

const css = readFileSync(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);
const root = css.match(/:root\s*\{([\s\S]*?)\}/)[1];
const tokens = Object.fromEntries(
  [...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);
function resolve(name) {
  assert.ok(tokens[name], `Missing theme token ${name}`);
  const reference = tokens[name].match(/^var\((--[\w-]+)\)$/);
  return reference ? resolve(reference[1]) : tokens[name];
}
function rgb(name) {
  const color = resolve(name);
  assert.match(color, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
  return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
}
function luminance(color) {
  const channels = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function ratio(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function check(foreground, background, minimum, opacity = 1) {
  const bg = rgb(background),
    fg = rgb(foreground).map(
      (value, i) => value * opacity + bg[i] * (1 - opacity),
    );
  const contrast = ratio(fg, bg);
  assert.ok(
    contrast >= minimum,
    `${foreground} on ${background}: ${contrast.toFixed(2)} < ${minimum}`,
  );
  return contrast;
}
const surfaces = [
  "--background",
  "--card",
  "--popover",
  "--muted",
  "--secondary",
  "--accent",
];

test("theme text, including secondary and off-state labels, meets 4.5:1 on its surfaces", () => {
  assert.equal(ratio([255, 255, 255], [0, 0, 0]), 21);
  for (const foreground of [
    "--foreground",
    "--muted-foreground",
    "--subtle-foreground",
    "--long",
    "--short",
  ])
    for (const background of surfaces) check(foreground, background, 4.5);
  for (const [foreground, background] of [
    ["--primary-foreground", "--primary"],
    ["--destructive-foreground", "--destructive"],
    ["--warning", "--warning-surface"],
    ["--selection-foreground", "--selection"],
    ["--chart-price-label-text", "--chart-price-label"],
  ])
    check(foreground, background, 4.5);
});

test("essential control outlines, slider track, switch thumb and focus rings meet 3:1", () => {
  for (const surface of surfaces) {
    check("--ring", surface, 3);
    check("--input", surface, 3);
  }
  check("--slider-track", "--popover", 3);
  check("--primary", "--slider-track", 3);
  check("--background", "--input", 3);
  check("--background", "--primary", 3);
});

test("canvas roles exist in the shared theme and essential chart marks retain contrast at drawn opacity", () => {
  for (const variable of Object.values(CHART_THEME_VARIABLES))
    assert.ok(resolve(variable));
  check("--chart-axis-text", "--background", 4.5);
  for (const token of [
    "--long",
    "--short",
    "--sma9",
    "--sma21",
    "--sma50",
    "--sma200",
  ])
    check(token, "--background", 3, 0.8);
  for (const token of ["--chart-candle-up", "--chart-candle-down"])
    check(token, "--background", 3, 0.55);
});
