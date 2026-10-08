import twColors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

/**
 * Theme-aware colour palette.
 *
 * Every colour utility resolves to a CSS variable instead of a fixed hex, so a
 * theme can repaint the whole app at runtime without touching call sites.
 *
 * Colours are split by the property they paint, because a single Tailwind shade
 * plays two incompatible roles. `emerald-700` is dark text on a pale badge, but
 * `bg-emerald-700` is a saturated fill under white text. A single dark-mode
 * value cannot serve both, so backgrounds, text and borders each get their own
 * variable namespace:
 *
 *   --c-*   shared light value, and the fallback for everything else
 *   --bg-*  background-only override
 *   --tx-*  text-only override
 *   --bd-*  border-only override
 *
 * Utilities read `var(--bg-emerald-50, var(--c-emerald-50))`, so a theme only
 * declares the handful of values that differ from the light baseline.
 */

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Greys follow the active theme's own ramp so dark surfaces pick up its hue.
const NEUTRAL_HUES = ['slate', 'gray', 'zinc', 'neutral', 'stone'];

// Accent hues keep their identity; only their light/dark ends get swapped.
const CHROMATIC_HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

const HUES = [...NEUTRAL_HUES, ...CHROMATIC_HUES];

// App-specific tokens, defined per theme in index.css as --pal-*.
// The semantic half (body .. navy-deep) exists so pages can stop hardcoding
// the warm greys and navies that used to be written as arbitrary hex values.
const APP_TOKENS = [
  'graphite', 'clay', 'slate', 'steel', 'mist', 'sand',
  'body', 'muted', 'line', 'surface', 'brand', 'navy', 'navy-deep', 'danger',
];

/** '#f8fafc' -> '248 250 252' */
function channels(hex) {
  const raw = String(hex).replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const int = parseInt(full.slice(0, 6), 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

function color(prefix, name, base) {
  return `rgb(var(--${prefix}-${name}, var(${base})) / <alpha-value>)`;
}

/** Builds a full palette whose entries read the `prefix` namespace first. */
function palette(prefix) {
  const result = {
    white: color(prefix, 'white', '--c-white'),
    black: color(prefix, 'black', '--c-black'),
  };

  for (const hue of HUES) {
    result[hue] = {};
    for (const shade of SHADES) {
      if (twColors[hue]?.[shade]) {
        result[hue][shade] = color(prefix, `${hue}-${shade}`, `--c-${hue}-${shade}`);
      }
    }
  }

  for (const name of APP_TOKENS) {
    const token = color(prefix, name, `--pal-${name}`);
    // `slate` is both an app token (`text-slate`) and a Tailwind scale
    // (`text-slate-500`), so it keeps the scale and gains a DEFAULT.
    if (result[name] && typeof result[name] === 'object') result[name].DEFAULT = token;
    else result[name] = token;
  }

  return result;
}

/* --- Dark mode mappings -------------------------------------------------- */

// Neutral shades point at the theme's ramp: surfaces (s), lines (l), text (t).
const NEUTRAL_DARK = {
  bg: { 50: 's2', 100: 's2', 200: 's3', 300: 's3', 400: 's4', 500: 's4', 600: 's4', 700: 's3', 800: 's2', 900: 's1', 950: 's0' },
  tx: { 50: 't1', 100: 't1', 200: 't1', 300: 't2', 400: 't4', 500: 't3', 600: 't2', 700: 't1', 800: 't1', 900: 't1', 950: 't1' },
  bd: { 50: 'l1', 100: 'l1', 200: 'l1', 300: 'l2', 400: 'l2', 500: 'l3', 600: 'l3', 700: 'l3', 800: 'l2', 900: 'l1', 950: 'l1' },
};

// Pale chromatic tints become deep tints; mid and dark fills stay saturated so
// `bg-emerald-600 text-white` keeps working.
const CHROMATIC_DARK = {
  bg: { 50: 950, 100: 900, 200: 800, 300: 700 },
  // Dark chromatic text flips light so it reads on the deep tints above.
  tx: { 600: 300, 700: 300, 800: 200, 900: 200, 950: 100 },
  bd: { 50: 900, 100: 900, 200: 800, 300: 700 },
};

const themePalette = plugin(({ addBase }) => {
  const light = { '--c-white': '255 255 255', '--c-black': '0 0 0' };
  for (const hue of HUES) {
    for (const shade of SHADES) {
      if (twColors[hue]?.[shade]) light[`--c-${hue}-${shade}`] = channels(twColors[hue][shade]);
    }
  }

  const dark = {
    // Text stays true white on saturated fills even though surfaces darken.
    '--tx-white': '255 255 255',
    '--bg-white': 'var(--dk-s1)',
    '--bd-white': 'var(--dk-l1)',
    '--c-white': 'var(--dk-s1)',

    // `bg-graphite` backs solid buttons and modal scrims, so it stays dark ink
    // while `text-graphite` body copy flips light.
    '--tx-graphite': 'var(--dk-t1)',
    '--bd-graphite': 'var(--dk-l3)',
    '--tx-slate': 'var(--dk-t3)',
    '--bd-slate': 'var(--dk-l1)',
    '--tx-steel': 'var(--dk-t3)',
    '--bd-steel': 'var(--dk-l2)',
    '--bg-steel': 'var(--dk-s4)',
    '--bg-mist': 'var(--dk-s1)',
    '--tx-mist': 'var(--dk-t1)',
    '--bg-sand': 'var(--dk-s2)',
    '--tx-sand': 'var(--dk-t2)',

    '--tx-body': 'var(--dk-t2)',
    '--bg-body': 'var(--dk-s3)',
    '--tx-muted': 'var(--dk-t3)',
    '--bg-muted': 'var(--dk-s3)',
    '--bd-line': 'var(--dk-l1)',
    '--bg-line': 'var(--dk-l1)',
    '--bg-surface': 'var(--dk-s2)',
    '--tx-surface': 'var(--dk-t1)',
    '--bd-surface': 'var(--dk-l1)',

    // Deep brand brown and navy both read as "the primary accent" on a page,
    // so on dark surfaces they follow the theme accent rather than staying
    // near-black. Solid fills get their text flipped in index.css.
    '--tx-brand': 'var(--pal-clay)',
    '--bg-brand': 'var(--pal-clay)',
    '--bd-brand': 'var(--pal-clay)',
    '--tx-navy': 'var(--pal-clay)',
    '--bg-navy': 'var(--pal-clay)',
    '--bd-navy': 'var(--pal-clay)',
    // Alert badges stay a vivid red fill with white text; the same token used
    // as text flips light so it reads on dark panels.
    '--bg-danger': '225 29 72',
    '--tx-danger': '253 164 175',
    '--bd-danger': '225 29 72',
    '--tx-navy-deep': 'var(--pal-clay)',
    '--bg-navy-deep': 'var(--pal-clay)',
    '--bd-navy-deep': 'var(--pal-clay)',
  };

  for (const hue of NEUTRAL_HUES) {
    for (const [prefix, mapping] of Object.entries(NEUTRAL_DARK)) {
      for (const [shade, slot] of Object.entries(mapping)) {
        dark[`--${prefix}-${hue}-${shade}`] = `var(--dk-${slot})`;
      }
    }
    // Rings, gradients and SVG fills follow the background ramp.
    for (const [shade, slot] of Object.entries(NEUTRAL_DARK.bg)) {
      dark[`--c-${hue}-${shade}`] = `var(--dk-${slot})`;
    }
  }

  for (const hue of CHROMATIC_HUES) {
    for (const [prefix, mapping] of Object.entries(CHROMATIC_DARK)) {
      for (const [shade, source] of Object.entries(mapping)) {
        if (twColors[hue]?.[source]) {
          dark[`--${prefix}-${hue}-${shade}`] = channels(twColors[hue][source]);
        }
      }
    }
    for (const [shade, source] of Object.entries(CHROMATIC_DARK.bg)) {
      if (twColors[hue]?.[source]) dark[`--c-${hue}-${shade}`] = channels(twColors[hue][source]);
    }
  }

  addBase({ ':root': light, "html[data-theme-mode='dark']": dark });
});

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: palette('c'),
      backgroundColor: palette('bg'),
      textColor: palette('tx'),
      borderColor: palette('bd'),
      placeholderColor: palette('tx'),
      ringColor: palette('bd'),
      outlineColor: palette('bd'),
      divideColor: palette('bd'),
      caretColor: palette('tx'),
      fontFamily: {
        sans: ['var(--app-font-sans)'],
        display: ['var(--app-font-display)'],
      },
      boxShadow: {
        panel: '0 16px 40px var(--panel-shadow)',
      },
    },
  },
  plugins: [themePalette],
};
