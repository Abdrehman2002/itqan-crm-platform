import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Font catalogue ────────────────────────────────────────────────────────
export const FONT_OPTIONS = [
  { label: 'System Default', value: 'system-ui, -apple-system, sans-serif', googleFont: null },
  { label: 'Inter',          value: '"Inter", sans-serif',                   googleFont: 'Inter:wght@400;500;600;700' },
  { label: 'Roboto',         value: '"Roboto", sans-serif',                  googleFont: 'Roboto:wght@400;500;700' },
  { label: 'Poppins',        value: '"Poppins", sans-serif',                 googleFont: 'Poppins:wght@400;500;600;700' },
  { label: 'Lato',           value: '"Lato", sans-serif',                    googleFont: 'Lato:wght@400;700' },
  { label: 'Nunito',         value: '"Nunito", sans-serif',                  googleFont: 'Nunito:wght@400;500;600;700' },
  { label: 'Open Sans',      value: '"Open Sans", sans-serif',               googleFont: 'Open+Sans:wght@400;500;600;700' },
  { label: 'Playfair Display', value: '"Playfair Display", serif',           googleFont: 'Playfair+Display:wght@400;500;600;700' },
] as const;

export const FONT_SIZE_OPTIONS = [
  { label: 'XS — 12px', value: '12px' },
  { label: 'SM — 13px', value: '13px' },
  { label: 'MD — 14px', value: '14px' },  // default
  { label: 'LG — 15px', value: '15px' },
  { label: 'XL — 16px', value: '16px' },
] as const;

// Curated preset text colours
export const FONT_COLOR_PRESETS = [
  { label: 'Charcoal',      value: '#111827' },
  { label: 'Slate',         value: '#1e293b' },
  { label: 'Neutral',       value: '#374151' },
  { label: 'Cool Gray',     value: '#4b5563' },
  { label: 'Muted',         value: '#6b7280' },
  { label: 'Indigo',        value: '#4338ca' },
  { label: 'Brand Blue',    value: '#29ABE2' },
  { label: 'Forest Green',  value: '#166534' },
  { label: 'Rose',          value: '#be123c' },
  { label: 'Amber',         value: '#92400e' },
] as const;

export interface AppearanceState {
  theme:       'light' | 'dark' | 'system';
  density:     'compact' | 'default' | 'comfortable';
  fontFamily:  string;
  fontSize:    string;
  fontColor:   string;
  setTheme:       (v: AppearanceState['theme'])   => void;
  setDensity:     (v: AppearanceState['density']) => void;
  setFontFamily:  (v: string) => void;
  setFontSize:    (v: string) => void;
  setFontColor:   (v: string) => void;
  reset:          () => void;
}

const DEFAULTS = {
  theme:      'light'    as const,
  density:    'default'  as const,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize:   '14px',
  fontColor:  '#111827',
};

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setTheme:      (theme)      => set({ theme }),
      setDensity:    (density)    => set({ density }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontSize:   (fontSize)   => set({ fontSize }),
      setFontColor:  (fontColor)  => set({ fontColor }),
      reset:         ()           => set(DEFAULTS),
    }),
    { name: 'crm-appearance' },
  ),
);
