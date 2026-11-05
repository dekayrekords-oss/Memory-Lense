import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import {
  getSettings,
  loadSettings,
  subscribeSettings,
  type AppSettings,
} from '@/services/settings';

// One design language for the whole app: warm paper in light mode,
// deep ink in dark mode, one solid Meta-blue accent, big radii, big
// type, big touch targets. Screens never hardcode a hex again — they
// read tokens from useTheme()/useThemedStyles().

export interface ThemeTokens {
  scheme: 'light' | 'dark';
  bg: string;
  card: string;
  surfaceSoft: string;
  surfaceAlt: string;
  text: string;
  textSub: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  onAccent: string;
  danger: string;
  dangerText: string;
  dangerBg: string;
  successText: string;
  successBg: string;
  successBorder: string;
  warnText: string;
  warnBg: string;
  infoBg: string;
  cameraBg: string;
}

export const LIGHT_THEME: ThemeTokens = {
  scheme: 'light',
  bg: '#EDF0F3',
  card: '#FFFFFF',
  surfaceSoft: '#E7EDF5',
  surfaceAlt: '#F7F9FB',
  text: '#0E1622',
  textSub: '#51606F',
  textMuted: '#5B6B7A',
  border: '#D9E0E8',
  borderStrong: '#B9C4D0',
  accent: '#0064D1',
  accentSoft: '#E3EEFC',
  accentText: '#0B4FA8',
  onAccent: '#FFFFFF',
  danger: '#C62828',
  dangerText: '#8A1010',
  dangerBg: '#FFE9E9',
  successText: '#137333',
  successBg: '#E6F4EA',
  successBorder: '#CBE3D2',
  warnText: '#7A5200',
  warnBg: '#FFF4D6',
  infoBg: '#EDF4FF',
  cameraBg: '#000000',
};

export const DARK_THEME: ThemeTokens = {
  scheme: 'dark',
  bg: '#0B0F14',
  card: '#141B24',
  surfaceSoft: '#1B2534',
  surfaceAlt: '#10161F',
  text: '#EDF3FA',
  textSub: '#A7B6C8',
  textMuted: '#8496AB',
  border: '#26313F',
  borderStrong: '#33445A',
  accent: '#4DA3FF',
  accentSoft: '#16283F',
  accentText: '#8FC2FF',
  onAccent: '#FFFFFF',
  danger: '#FF6B5E',
  dangerText: '#FF9D94',
  dangerBg: '#3A1D1B',
  successText: '#4CC38A',
  successBg: '#14301F',
  successBorder: '#1E4D33',
  warnText: '#FFC24D',
  warnBg: '#3A2E12',
  infoBg: '#14273F',
  cameraBg: '#000000',
};

/** Pure resolution: explicit preference wins; 'system' follows the OS. */
export function resolveTheme(
  preference: AppSettings['themePreference'],
  systemScheme: 'light' | 'dark' | null | undefined,
): ThemeTokens {
  if (preference === 'light') return LIGHT_THEME;
  if (preference === 'dark') return DARK_THEME;
  return systemScheme === 'dark' ? DARK_THEME : LIGHT_THEME;
}

const ThemeContext = createContext<ThemeTokens>(LIGHT_THEME);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [settings, setSettings] = useState<AppSettings>(() => getSettings());

  useEffect(() => {
    let live = true;
    void loadSettings().then((loaded) => {
      if (live) setSettings(loaded);
    });
    const unsubscribe = subscribeSettings(setSettings);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  const theme = useMemo(
    () => resolveTheme(settings.themePreference, systemScheme),
    [settings.themePreference, systemScheme],
  );
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}

/** Memoized StyleSheet factory bound to the active theme. */
export function useThemedStyles<T>(
  factory: (theme: ThemeTokens) => T,
): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}
