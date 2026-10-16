// 화면을 막지 않는 짧은 알림. 확인 버튼을 눌러야 하는 showAlert 대신 성공 안내에 사용한다.

const TONE_ICONS = {
  success: 'fa-circle-check',
  danger: 'fa-circle-exclamation',
  info: 'fa-circle-info'
};

function getContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, { tone = 'success', duration = 3200, actionLabel = '', onAction = null } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;

  const icon = document.createElement('i');
  icon.className = `fas ${TONE_ICONS[tone] || TONE_ICONS.info}`;
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;

  toast.append(icon, text);

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
