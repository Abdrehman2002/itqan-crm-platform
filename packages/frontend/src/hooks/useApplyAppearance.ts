import { useEffect } from 'react';
import { useAppearanceStore, FONT_OPTIONS } from '../store/appearance.store';

const loadedFonts = new Set<string>();

function loadGoogleFont(fontQuery: string) {
  if (loadedFonts.has(fontQuery)) return;
  loadedFonts.add(fontQuery);
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fontQuery}&display=swap`;
  document.head.appendChild(link);
}

function resolvedTheme(pref: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Call once near the root of the app.
 * Applies font-family, font-size, font-color as CSS custom properties
 * and toggles the `dark` class on <html> for Tailwind dark mode.
 */
export function useApplyAppearance() {
  const { theme, fontFamily, fontSize, fontColor } = useAppearanceStore();

  useEffect(() => {
    const root = document.documentElement;
    const effective = resolvedTheme(theme);

    // Theme
    root.classList.toggle('dark', effective === 'dark');

    // Font family — load from Google Fonts if needed
    const option = FONT_OPTIONS.find(f => f.value === fontFamily);
    if (option?.googleFont) loadGoogleFont(option.googleFont);

    // CSS custom properties consumed by the global stylesheet
    root.style.setProperty('--app-font-family', fontFamily);
    root.style.setProperty('--app-font-size',   fontSize);
    root.style.setProperty('--app-font-color',  fontColor);
  }, [theme, fontFamily, fontSize, fontColor]);

  // Listen for system theme change when pref = 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      document.documentElement.classList.toggle('dark', mq.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);
}
