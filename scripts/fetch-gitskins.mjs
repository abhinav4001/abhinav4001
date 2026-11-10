/**
 * Fetches the GitSkins contribution "city" and "heatmap" SVGs, remaps their
 * palette to graphite + ember, strips the baked-in gitskins.com watermark and
 * writes the result into .github/assets so the README can reference it locally.
 *
 * Runs before the readme-aura build (see .github/workflows/readme-aura.yml).
 * Attribution to gitskins.com lives in the README footer.
 */
import fs from "node:fs/promises";
import path from "node:path";

const USER = process.env.GITHUB_USER ?? "abhinav4001";
const THEME = process.env.GITSKINS_THEME ?? "retro";
const OUT_DIR = path.resolve(process.argv[2] ?? ".github/assets");
const SECTIONS = ["city", "heatmap"];

/** Target accent hue, matching the ember palette in readme.source.md. */
const ACCENT_HUE = 25;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function parseColor(token) {
  let m = token.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1, kind: "hex" };
  }
  m = token.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1, kind: "hex" };
  }
  m = token.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i);
  if (m) {
    return {
      r: +m[1], g: +m[2], b: +m[3],
      a: m[4] === undefined ? 1 : +m[4],
      kind: "rgb",
    };
  }
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((v) => Math.round(v * 255));
}

const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => clamp(v, 0, 255).toString(16).padStart(2, "0")).join("");

/** Remap one colour token to the graphite + ember palette. */
function remap(token) {
  const c = parseColor(token);
  if (!c) return token;
  const { s, l } = rgbToHsl(c.r, c.g, c.b);

  let rgb;
  if (l <= 0.28) {
    // Structural darks (page + grid + cell edges) -> neutral graphite ramp.
    rgb = hslToRgb(255, 0.05, clamp(l * 0.72, 0.02, 0.16));
  } else {
    // Everything else (pinks, violets, near-whites) -> ember family.
    rgb = hslToRgb(ACCENT_HUE, clamp(s * 1.05, 0.35, 1), l);
  }

  if (c.kind === "hex") return hex(rgb);
  const [r, g, b] = rgb;
  return c.a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${c.a})`;
}

const COLOR_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\brgba?\([^)]*\)/g;

function transform(svg) {
  // Drop the baked-in watermark text node.
  let out = svg.replace(/<text\b[^>]*>[^<]*gitskins\.com[^<]*<\/text>/gi, "");

  const cache = new Map();
  out = out.replace(COLOR_RE, (token) => {
    if (!cache.has(token)) cache.set(token, remap(token));
    return cache.get(token);
  });
  return out;
}

await fs.mkdir(OUT_DIR, { recursive: true });

for (const section of SECTIONS) {
  const url = `https://www.gitskins.com/api/section/${section}?username=${USER}&theme=${THEME}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${section}: HTTP ${res.status} from ${url}`);

  const svg = await res.text();
  if (!svg.includes("<svg")) throw new Error(`${section}: response is not an SVG`);

  const themed = transform(svg);
  const file = path.join(OUT_DIR, `${section}.svg`);
  await fs.writeFile(file, themed, "utf8");

  const leftover = themed.match(/#ec4899|#f9a8d4|#fce7f3|gitskins\.com/gi);
  console.log(
    `  ${section}.svg  ${(themed.length / 1024).toFixed(1)} KB` +
      (leftover ? `  WARNING leftovers: ${[...new Set(leftover)].join(", ")}` : "  clean"),
  );
}
