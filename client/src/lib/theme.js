import { storage } from './storage.js';

const KEY = 'cloudmojo.tracker.theme';

/** 'light' | 'dark' — dark is a selected set of steps, not an inverted light. */
export function getTheme() {
  const saved = storage.get(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  storage.set(KEY, theme);
}

/** Read a CSS custom property so charts and chrome share one source of truth. */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
