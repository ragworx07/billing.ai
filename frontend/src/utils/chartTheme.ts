import { useMemo } from 'react';

import { useAppearance } from '../contexts/AppearanceContext';

/**
 * Recharts wants concrete colour values because it writes them as SVG
 * attributes, where `var()` does not resolve. Chart chrome (grid, axes,
 * tooltips) is themed with CSS in index.css; this hook covers the series
 * colours that have to be passed as props.
 */
export type ChartTheme = {
  /** Money coming in. */
  inflow: string;
  /** Money going out. */
  outflow: string;
  /** Net / running total line. */
  net: string;
  /** Theme accent, for single-series charts. */
  accent: string;
};

/** Reads the first defined custom property, as `rgb(r g b)`. */
function readChannels(names: string[], fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const root = getComputedStyle(document.documentElement);
  for (const name of names) {
    const value = root.getPropertyValue(name).trim();
    if (value) return `rgb(${value})`;
  }
  return fallback;
}

export function useChartTheme(): ChartTheme {
  const { appearance } = useAppearance();

  // Re-read whenever anything that can repaint the palette changes.
  return useMemo<ChartTheme>(
    () => ({
      inflow: readChannels(['--c-emerald-600'], '#059669'),
      // --bg-danger is the dark-mode fill; --pal-danger the light-theme value.
      outflow: readChannels(['--bg-danger', '--pal-danger'], '#c85a4b'),
      net: readChannels(['--pal-clay'], '#7c4a27'),
      accent: readChannels(['--pal-clay'], '#b4653d'),
    }),
    [appearance.theme, appearance.accent, appearance.highContrast],
  );
}
