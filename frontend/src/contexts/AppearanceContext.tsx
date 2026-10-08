import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import {
  applyAppearance,
  clampZoom,
  defaultAppearance,
  getSavedAppearance,
  saveAppearance,
  ZOOM_STEP,
  type AppearancePreferences,
} from '../utils/appearance';

type AppearanceContextValue = {
  appearance: AppearancePreferences;
  setPreference: <K extends keyof AppearancePreferences>(
    key: K,
    value: AppearancePreferences[K],
  ) => void;
  stepZoom: (direction: 1 | -1) => void;
  resetAppearance: () => void;
  isDefault: boolean;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => getSavedAppearance());

  const commit = useCallback((next: AppearancePreferences) => {
    setAppearance(next);
    saveAppearance(next);
  }, []);

  const setPreference = useCallback(
    <K extends keyof AppearancePreferences>(key: K, value: AppearancePreferences[K]) => {
      setAppearance((current) => {
        const next = { ...current, [key]: value };
        if (key === 'zoom') next.zoom = clampZoom(next.zoom);
        saveAppearance(next);
        return next;
      });
    },
    [],
  );

  const stepZoom = useCallback((direction: 1 | -1) => {
    setAppearance((current) => {
      const next = { ...current, zoom: clampZoom(current.zoom + direction * ZOOM_STEP) };
      saveAppearance(next);
      return next;
    });
  }, []);

  const resetAppearance = useCallback(() => commit({ ...defaultAppearance }), [commit]);

  const isDefault = useMemo(
    () =>
      (Object.keys(defaultAppearance) as Array<keyof AppearancePreferences>).every(
        (key) => appearance[key] === defaultAppearance[key],
      ),
    [appearance],
  );

  const value = useMemo(
    () => ({ appearance, setPreference, stepZoom, resetAppearance, isDefault }),
    [appearance, setPreference, stepZoom, resetAppearance, isDefault],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance must be used within AppearanceProvider');
  return context;
}
