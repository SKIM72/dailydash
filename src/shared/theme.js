const THEME_STORAGE_KEY = 'dailydash-theme-preference';
const THEME_OPTIONS = new Set(['system', 'light', 'dark']);
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

let systemListenerInstalled = false;

function normalizeThemePreference(preference) {
  return THEME_OPTIONS.has(preference) ? preference : 'system';
}

function getSystemTheme() {
  return window.matchMedia?.(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light';
}

export function getThemePreference() {
  try {
    return normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference = getThemePreference()) {
  const normalized = normalizeThemePreference(preference);
  return normalized === 'system' ? getSystemTheme() : normalized;
}

function updateThemeButtons(preference) {
  document.querySelectorAll('[data-theme-option]').forEach((button) => {
    const isActive = button.dataset.themeOption === preference;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-checked', String(isActive));
  });
}

export function applyThemePreference(preference = getThemePreference()) {
  const normalized = normalizeThemePreference(preference);
  const resolvedTheme = resolveTheme(normalized);
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = normalized;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', resolvedTheme === 'dark' ? '#0f172a' : '#6366f1');

  updateThemeButtons(normalized);
  return { preference: normalized, theme: resolvedTheme };
}

export function setThemePreference(preference) {
  const normalized = normalizeThemePreference(preference);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage failures and still apply the in-memory choice for this page.
  }
  return applyThemePreference(normalized);
}

export function initTheme() {
  applyThemePreference();

  if (!systemListenerInstalled && window.matchMedia) {
    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const handleSystemThemeChange = () => {
      if (getThemePreference() === 'system') applyThemePreference('system');
    };
    if (media.addEventListener) {
      media.addEventListener('change', handleSystemThemeChange);
    } else {
      media.addListener?.(handleSystemThemeChange);
    }
    systemListenerInstalled = true;
  }
}

export function installThemeControls() {
  initTheme();

  document.querySelectorAll('[data-theme-option]').forEach((button) => {
    button.addEventListener('click', () => {
      setThemePreference(button.dataset.themeOption);
    });
  });
}
