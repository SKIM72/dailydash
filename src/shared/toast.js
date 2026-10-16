// 스낵바: 화면을 막지 않는 짧은 알림. 확인 버튼을 눌러야 하는 showAlert 대신 성공 안내에 쓴다.
import { iconSvg } from './icons.js';

const TONE_ICONS = {
  success: 'check',
  danger: 'danger',
  info: 'info'
};

function getContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'snackbar-host toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, { tone = 'success', duration = 3200, actionLabel = '', onAction = null } = {}) {
  const toast = document.createElement('div');
  toast.className = `snackbar toast toast-${tone}`;
  toast.innerHTML = iconSvg(TONE_ICONS[tone] || TONE_ICONS.info, { variant: tone === 'success' ? 'bold' : 'bulk' });

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  toast.appendChild(text);

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 200);
  };

  if (actionLabel && onAction) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      dismiss();
      onAction();
    });
    toast.appendChild(action);
  }

  getContainer().appendChild(toast);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}
