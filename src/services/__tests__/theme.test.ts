import { describe, expect, it } from '@jest/globals';
import { DARK_THEME, LIGHT_THEME, resolveTheme } from '@/components/theme';
import { parseSettings } from '../settings';

describe('resolveTheme', () => {
  it('explicit preference beats the OS scheme', () => {
    expect(resolveTheme('light', 'dark')).toBe(LIGHT_THEME);
    expect(resolveTheme('dark', 'light')).toBe(DARK_THEME);
  });

  it('system follows the OS, defaulting to light', () => {
    expect(resolveTheme('system', 'dark')).toBe(DARK_THEME);
    expect(resolveTheme('system', 'light')).toBe(LIGHT_THEME);
    expect(resolveTheme('system', null)).toBe(LIGHT_THEME);
    expect(resolveTheme('system', undefined)).toBe(LIGHT_THEME);
  });

  it('both palettes keep text readable (distinct, non-gray text)', () => {
    expect(LIGHT_THEME.text).not.toBe(LIGHT_THEME.bg);
    expect(DARK_THEME.text).not.toBe(DARK_THEME.bg);
    expect(LIGHT_THEME.accent).not.toBe(DARK_THEME.accent);
  });
});

describe('parseSettings theme preference', () => {
  it('keeps a valid preference and defaults junk to system', () => {
    expect(parseSettings({ themePreference: 'dark' }).themePreference).toBe(
      'dark',
    );
    expect(parseSettings({ themePreference: 'light' }).themePreference).toBe(
      'light',
    );
    expect(parseSettings({ themePreference: 'neon' }).themePreference).toBe(
      'system',
    );
    expect(parseSettings({}).themePreference).toBe('system');
  });
});
