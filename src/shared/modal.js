import { iconSvg } from './icons.js';

// 첫 줄은 제목, 나머지 줄은 상세 내용 상자로 보여준다. (줄바꿈 또는 <br> 로 구분)
export function renderModalMessage(target, message, { emphasizeLine = -1 } = {}) {
  target.replaceChildren();
  const lines = String(message).split(/<br\s*\/?>|\n/i).map((line) => line.trim()).filter(Boolean);
  const [headline = '', ...details] = lines;

  const title = document.createElement('strong');
  title.className = 'dialog__headline';
  title.textContent = headline;
  target.appendChild(title);

  if (details.length) {
    const list = document.createElement('ul');
    list.className = 'dialog__detail';
    details.forEach((line, index) => {
      const item = document.createElement('li');
      item.textContent = line;
      if (index + 1 === emphasizeLine) item.classList.add('is-strong');
      list.appendChild(item);
    });
    target.appendChild(list);
  }
}

function setDialogTone(modal, tone, iconName) {
  const dialog = modal.querySelector('.dialog');
  const iconWrap = modal.querySelector('.dialog__icon');
  if (dialog) dialog.dataset.tone = tone;
  if (iconWrap) iconWrap.innerHTML = iconSvg(iconName);
}

// 열린 모달 순서. 마이페이지 위에 확인창이 뜬 경우 Esc 는 맨 위 창만 닫는다.
const modalStack = [];

// 모달을 열 때 Esc 키 / 배경 클릭으로 닫히게 하고, 닫으면 원래 포커스로 돌려준다.
function openModal(modal, { initialFocus, onDismiss }) {
  const previouslyFocused = document.activeElement;
  modal.classList.remove('hidden-view');
  modalStack.push(modal);
  initialFocus?.focus();

  const handleKeydown = (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && modalStack[modalStack.length - 1] === modal) {
      event.preventDefault();
      onDismiss();
    }
  };
  const handleBackdrop = (event) => {
    if (event.target === modal) onDismiss();
  };
  document.addEventListener('keydown', handleKeydown);
  modal.addEventListener('click', handleBackdrop);

  return () => {
    modal.classList.add('hidden-view');
    const index = modalStack.lastIndexOf(modal);
    if (index >= 0) modalStack.splice(index, 1);
    document.removeEventListener('keydown', handleKeydown);
    modal.removeEventListener('click', handleBackdrop);
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
  };
}

// 마이페이지/상세 내역처럼 일반 모달 창에 Esc · 배경 클릭 닫기를 붙인다.
export function bindDismissibleModal(modal, closeButton) {
  if (!modal) return { open() {}, close() {}, isOpen: () => false };
  let release = null;
  const close = () => {
    release?.();
    release = null;
  };
  const open = () => {
    if (release) return;
    release = openModal(modal, { initialFocus: closeButton, onDismiss: close });
  };
  closeButton?.addEventListener('click', close);
  return { open, close, isOpen: () => Boolean(release) };
}

export function installModalHandlers() {
  // options: { tone: 'primary' | 'danger' | 'success', icon, emphasizeLine }
  window.showAlert = (message, options = {}) => {
    return new Promise((resolve) => {
      const modal = document.getElementById('custom-alert-modal');
      const msgEl = document.getElementById('alert-message');
      const okBtn = document.getElementById('alert-ok-btn');
      if (!modal || !msgEl || !okBtn) {
        alert(String(message).replace(/<br\s*\/?>/gi, '\n'));
        resolve();
        return;
      }
      const tone = options.tone || (/(실패|오류|에러)/.test(message) ? 'danger' : 'primary');
      setDialogTone(modal, tone, options.icon || (tone === 'danger' ? 'danger' : tone === 'success' ? 'check' : 'info'));
      renderModalMessage(msgEl, message, options);
      let release = null;
      const handleOk = () => {
        okBtn.removeEventListener('click', handleOk);
        release();
        resolve();
      };
      okBtn.addEventListener('click', handleOk);
      release = openModal(modal, { initialFocus: okBtn, onDismiss: handleOk });
    });
  };

  // options: { danger, confirmLabel, icon }
  // danger 가 true 면 실수로 Enter 를 눌러도 실행되지 않도록 '취소'에 포커스를 둔다.
  window.showConfirm = (message, options = {}) => {
    return new Promise((resolve) => {
      const modal = document.getElementById('custom-confirm-modal');
      const msgEl = document.getElementById('confirm-message');
      const yesBtn = document.getElementById('confirm-yes-btn');
      const noBtn = document.getElementById('confirm-no-btn');
      if (!modal || !msgEl || !yesBtn || !noBtn) {
        resolve(confirm(String(message).replace(/<br\s*\/?>/gi, '\n')));
        return;
      }
      const isDanger = options.danger !== false;
      setDialogTone(modal, isDanger ? 'danger' : 'primary', options.icon || (isDanger ? 'danger' : 'info'));
      renderModalMessage(msgEl, message);
      yesBtn.textContent = options.confirmLabel || '확인';
      yesBtn.classList.toggle('btn--danger', isDanger);

      let release = null;
      const finish = (result) => {
        yesBtn.removeEventListener('click', handleYes);
        noBtn.removeEventListener('click', handleNo);
        release();
        resolve(result);
      };
      const handleYes = () => finish(true);
      const handleNo = () => finish(false);
      yesBtn.addEventListener('click', handleYes);
      noBtn.addEventListener('click', handleNo);
      release = openModal(modal, {
        initialFocus: options.danger ? noBtn : yesBtn,
        onDismiss: handleNo
      });
    });
  };
}
