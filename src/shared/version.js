export const APP_VERSION = '0.3.1';
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026.06.05';

export function renderVersionLabels(root = document) {
  root.querySelectorAll('[data-app-version]').forEach((element) => {
    element.textContent = APP_VERSION_LABEL;
  });
  root.querySelectorAll('[data-app-release-date]').forEach((element) => {
    element.textContent = APP_RELEASE_DATE;
  });
}
