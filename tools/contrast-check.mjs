// WCAG 2.1 contrast ratio checker (relative-luminance formula, sRGB).
// Same math as the WebAIM Contrast Checker. Run: node tools/contrast-check.mjs
// Records the ratios that back the design tokens; not shipped in the app bundle.

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function ratio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// [label, foreground, background, kind] where kind sets the passing bar:
//   text     -> AA normal text, needs >= 4.5
//   large    -> AA large/bold text, needs >= 3.0
//   graphic  -> non-text UI (icons, borders, focus), needs >= 3.0
const PAIRS = [
  ['body ink on white', '#1b1d21', '#ffffff', 'text'],
  ['ink on surface-soft', '#1b1d21', '#f4f6f9', 'text'],
  ['secondary ink-soft on white', '#585d66', '#ffffff', 'text'],
  ['secondary ink-soft on surface-soft', '#585d66', '#f4f6f9', 'text'],
  ['tertiary ink-mute on white', '#6f757e', '#ffffff', 'large'],
  ['white on accent (primary button)', '#ffffff', '#2350c9', 'text'],
  ['accent link on white', '#2350c9', '#ffffff', 'text'],
  ['danger text on white', '#a5301f', '#ffffff', 'text'],
  ['danger text on danger tint', '#8f2b1c', '#fdecea', 'text'],
  ['control border (line-strong) on white', '#838a93', '#ffffff', 'graphic'],
  ['control border on surface-soft', '#838a93', '#f4f6f9', 'graphic'],
  ['focus ring on white', '#2350c9', '#ffffff', 'graphic'],
  // status chips: label text is always ink; icon carries hue as a graphic object
  ['status label ink on draft tint', '#1b1d21', '#eef1f5', 'text'],
  ['status label ink on review tint', '#1b1d21', '#fdf3e0', 'text'],
  ['status label ink on approved tint', '#1b1d21', '#e6f4ea', 'text'],
  ['status label ink on archived tint', '#1b1d21', '#edeef1', 'text'],
  ['draft icon on draft tint', '#515a67', '#eef1f5', 'graphic'],
  ['review icon on review tint', '#8a5a00', '#fdf3e0', 'graphic'],
  ['approved icon on approved tint', '#1f7a43', '#e6f4ea', 'graphic'],
  ['archived icon on archived tint', '#5b626c', '#edeef1', 'graphic'],
];

const BAR = { text: 4.5, large: 3.0, graphic: 3.0 };
let allPass = true;
for (const [label, fg, bg, kind] of PAIRS) {
  const r = ratio(fg, bg);
  const pass = r >= BAR[kind];
  if (!pass) allPass = false;
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(
    `${tag}  ${r.toFixed(2)}:1  (need ${BAR[kind].toFixed(1)}, ${kind})  ${label}  ${fg} on ${bg}`,
  );
}
console.log(allPass ? '\nAll pairs pass their WCAG AA bar.' : '\nSome pairs FAIL.');
process.exit(allPass ? 0 : 1);
