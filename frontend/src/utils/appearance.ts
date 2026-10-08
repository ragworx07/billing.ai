export type AppThemeId =
  | 'sandstone'
  | 'paper'
  | 'nordic'
  | 'sage'
  | 'blush'
  | 'azure'
  | 'midnight'
  | 'carbon'
  | 'forest'
  | 'plum';

export type AppThemeMode = 'light' | 'dark';

export type AppFontFamily = 'manrope' | 'inter' | 'system' | 'serif' | 'mono' | 'nunito';

export type AppFontSize = 'small' | 'medium' | 'large' | 'very-large';

export type AppDensity = 'compact' | 'cozy' | 'comfortable';

export type AppCorners = 'sharp' | 'soft' | 'rounded';

export type AppAccent = 'theme' | 'clay' | 'indigo' | 'teal' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';

export type AppearancePreferences = {
  theme: AppThemeId;
  accent: AppAccent;
  fontFamily: AppFontFamily;
  fontSize: AppFontSize;
  /** Whole-interface zoom as a percentage, 60 - 160. */
  zoom: number;
  density: AppDensity;
  corners: AppCorners;
  reduceMotion: boolean;
  highContrast: boolean;
  sidebarCollapsed: boolean;
};

export const APPEARANCE_STORAGE_KEY = 'cido_appearance_v1';
export const LEGACY_FONT_SIZE_STORAGE_KEY = 'cido_app_font_size';

export const defaultAppearance: AppearancePreferences = {
  theme: 'sandstone',
  accent: 'theme',
  fontFamily: 'manrope',
  fontSize: 'medium',
  zoom: 100,
  density: 'cozy',
  corners: 'rounded',
  reduceMotion: false,
  highContrast: false,
  sidebarCollapsed: false,
};

export const ZOOM_MIN = 60;
export const ZOOM_MAX = 160;
export const ZOOM_STEP = 5;

/** `swatch` drives the small theme preview tiles on the settings page. */
export const themeOptions: Array<{
  value: AppThemeId;
  label: string;
  description: string;
  mode: AppThemeMode;
  swatch: { bg: string; panel: string; accent: string; ink: string };
}> = [
  {
    value: 'sandstone',
    label: 'Sandstone',
    description: 'The original warm KKR palette.',
    mode: 'light',
    swatch: { bg: '#f3ece1', panel: '#fbf8f3', accent: '#b4653d', ink: '#1b1b18' },
  },
  {
    value: 'paper',
    label: 'Paper',
    description: 'Crisp white cards with a clean grey base.',
    mode: 'light',
    swatch: { bg: '#f1f2f4', panel: '#ffffff', accent: '#2563eb', ink: '#111827' },
  },
  {
    value: 'nordic',
    label: 'Nordic Mist',
    description: 'Cool blue-grey with a teal accent.',
    mode: 'light',
    swatch: { bg: '#eaeff4', panel: '#fbfdfe', accent: '#0f766e', ink: '#16222e' },
  },
  {
    value: 'sage',
    label: 'Sage Garden',
    description: 'Soft botanical greens, easy on the eyes.',
    mode: 'light',
    swatch: { bg: '#e9f0e7', panel: '#fbfdfa', accent: '#3f6b3a', ink: '#1a231a' },
  },
  {
    value: 'blush',
    label: 'Blush Quartz',
    description: 'Warm rose tones with plum text.',
    mode: 'light',
    swatch: { bg: '#f6eaee', panel: '#fffbfc', accent: '#a8385c', ink: '#2a1720' },
  },
  {
    value: 'azure',
    label: 'Azure Sky',
    description: 'Bright and corporate, blue forward.',
    mode: 'light',
    swatch: { bg: '#e8eff9', panel: '#fbfdff', accent: '#1d4ed8', ink: '#141d2e' },
  },
  {
    value: 'midnight',
    label: 'Midnight',
    description: 'Deep navy dark mode with indigo highlights.',
    mode: 'dark',
    swatch: { bg: '#0f1420', panel: '#181e2c', accent: '#818cf8', ink: '#e2e8f0' },
  },
  {
    value: 'carbon',
    label: 'Carbon',
    description: 'Neutral charcoal dark mode, amber accent.',
    mode: 'dark',
    swatch: { bg: '#151515', panel: '#1f1f1e', accent: '#f0a94c', ink: '#e8e6e1' },
  },
  {
    value: 'forest',
    label: 'Deep Forest',
    description: 'Dark green-teal, calm and low glare.',
    mode: 'dark',
    swatch: { bg: '#0c1714', panel: '#152220', accent: '#4ecfa0', ink: '#dceae4' },
  },
  {
    value: 'plum',
    label: 'Velvet Plum',
    description: 'Dark aubergine with a pink highlight.',
    mode: 'dark',
    swatch: { bg: '#150f1c', panel: '#1f1729', accent: '#e07bb4', ink: '#eae0f0' },
  },
];

export const accentOptions: Array<{ value: AppAccent; label: string; swatch: string }> = [
  { value: 'theme', label: 'Theme default', swatch: 'currentColor' },
  { value: 'clay', label: 'Clay', swatch: '#b4653d' },
  { value: 'indigo', label: 'Indigo', swatch: '#5b5bd6' },
  { value: 'teal', label: 'Teal', swatch: '#0f766e' },
  { value: 'emerald', label: 'Emerald', swatch: '#047857' },
  { value: 'amber', label: 'Amber', swatch: '#a16207' },
  { value: 'rose', label: 'Rose', swatch: '#be3455' },
  { value: 'violet', label: 'Violet', swatch: '#7c4dbd' },
  { value: 'slate', label: 'Graphite', swatch: '#4a5568' },
];

export const fontFamilyOptions: Array<{
  value: AppFontFamily;
  label: string;
  description: string;
  /** Inline preview font, kept in sync with the CSS variable for the same key. */
  preview: string;
}> = [
  {
    value: 'manrope',
    label: 'Manrope',
    description: 'App default. Geometric and compact.',
    preview: '"Manrope", ui-sans-serif, system-ui, sans-serif',
  },
  {
    value: 'inter',
    label: 'Inter',
    description: 'Neutral UI font with tall x-height.',
    preview: '"Inter", ui-sans-serif, system-ui, sans-serif',
  },
  {
    value: 'nunito',
    label: 'Nunito',
    description: 'Rounded and friendly.',
    preview: '"Nunito", ui-sans-serif, system-ui, sans-serif',
  },
  {
    value: 'system',
    label: 'System',
    description: 'Matches your operating system font.',
    preview:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    value: 'serif',
    label: 'Serif',
    description: 'Classic printed look for long reading.',
    preview: '"Lora", Georgia, "Times New Roman", serif',
  },
  {
    value: 'mono',
    label: 'Monospace',
    description: 'Fixed width, good for numbers and ledgers.',
    preview: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
  },
];

export const fontSizeOptions: Array<{ value: AppFontSize; label: string; description: string }> = [
  { value: 'small', label: 'Small', description: 'More rows and controls fit on screen.' },
  { value: 'medium', label: 'Medium', description: 'Current default size.' },
  { value: 'large', label: 'Large', description: 'Larger text for daily use.' },
  { value: 'very-large', label: 'Very Large', description: 'Maximum readability across the app.' },
];

export const densityOptions: Array<{ value: AppDensity; label: string; description: string }> = [
  { value: 'compact', label: 'Compact', description: 'Tighter tables and inputs.' },
  { value: 'cozy', label: 'Cozy', description: 'Balanced default spacing.' },
  { value: 'comfortable', label: 'Comfortable', description: 'Roomier rows and taller fields.' },
];

export const cornerOptions: Array<{ value: AppCorners; label: string; description: string }> = [
  { value: 'sharp', label: 'Sharp', description: 'Square edges on cards and fields.' },
  { value: 'soft', label: 'Soft', description: 'Lightly rounded edges.' },
  { value: 'rounded', label: 'Rounded', description: 'Fully rounded default look.' },
];

const themeIds = new Set<AppThemeId>(themeOptions.map((option) => option.value));
const accentIds = new Set<AppAccent>(accentOptions.map((option) => option.value));
const fontFamilyIds = new Set<AppFontFamily>(fontFamilyOptions.map((option) => option.value));
const fontSizeIds = new Set<AppFontSize>(fontSizeOptions.map((option) => option.value));
const densityIds = new Set<AppDensity>(densityOptions.map((option) => option.value));
const cornerIds = new Set<AppCorners>(cornerOptions.map((option) => option.value));

export function getThemeMode(theme: AppThemeId): AppThemeMode {
  return themeOptions.find((option) => option.value === theme)?.mode ?? 'light';
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return defaultAppearance.zoom;
  const snapped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

function pick<T>(allowed: Set<T>, value: unknown, fallback: T): T {
  return allowed.has(value as T) ? (value as T) : fallback;
}

export function normalizeAppearance(raw: unknown): AppearancePreferences {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppearancePreferences>;
  return {
    theme: pick(themeIds, source.theme, defaultAppearance.theme),
    accent: pick(accentIds, source.accent, defaultAppearance.accent),
    fontFamily: pick(fontFamilyIds, source.fontFamily, defaultAppearance.fontFamily),
    fontSize: pick(fontSizeIds, source.fontSize, defaultAppearance.fontSize),
    zoom: clampZoom(Number(source.zoom ?? defaultAppearance.zoom)),
    density: pick(densityIds, source.density, defaultAppearance.density),
    corners: pick(cornerIds, source.corners, defaultAppearance.corners),
    reduceMotion: Boolean(source.reduceMotion ?? defaultAppearance.reduceMotion),
    highContrast: Boolean(source.highContrast ?? defaultAppearance.highContrast),
    sidebarCollapsed: Boolean(source.sidebarCollapsed ?? defaultAppearance.sidebarCollapsed),
  };
}

export function getSavedAppearance(): AppearancePreferences {
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored) return normalizeAppearance(JSON.parse(stored));

    // Settings used to persist only a font size under its own key.
    const legacyFontSize = localStorage.getItem(LEGACY_FONT_SIZE_STORAGE_KEY);
    if (legacyFontSize) {
      return normalizeAppearance({ ...defaultAppearance, fontSize: legacyFontSize });
    }
  } catch {
    // Corrupt or unavailable storage falls back to defaults.
  }
  return { ...defaultAppearance };
}

export function applyAppearance(preferences: AppearancePreferences) {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.themeMode = getThemeMode(preferences.theme);
  root.dataset.accent = preferences.accent;
  root.dataset.appFont = preferences.fontFamily;
  root.dataset.appFontSize = preferences.fontSize;
  root.dataset.density = preferences.density;
  root.dataset.corners = preferences.corners;
  root.dataset.reduceMotion = String(preferences.reduceMotion);
  root.dataset.highContrast = String(preferences.highContrast);
  root.style.setProperty('--app-zoom', String(preferences.zoom / 100));
  root.style.colorScheme = getThemeMode(preferences.theme);
}

export function saveAppearance(preferences: AppearancePreferences) {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
    localStorage.removeItem(LEGACY_FONT_SIZE_STORAGE_KEY);
  } catch {
    // Preference still applies for this session even if it cannot be stored.
  }
  applyAppearance(preferences);
}
