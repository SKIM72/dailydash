export function renderModalMessage(target, message) {
  target.replaceChildren();
  String(message).split(/<br\s*\/?>|\n/i).forEach((part, index) => {
    if (index > 0) target.appendChild(document.createElement('br'));
    target.appendChild(document.createTextNode(part));
  });
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
  if (!modal) return { open() {}, close() {} };
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
  return { open, close };
}

export function installModalHandlers() {
  window.showAlert = (message) => {
    return new Promise((resolve) => {
      const modal = document.getElementById('custom-alert-modal');
      const msgEl = document.getElementById('alert-message');
      const okBtn = document.getElementById('alert-ok-btn');
      if (!modal || !msgEl || !okBtn) {
        alert(message);
        resolve();
        return;
      }
      renderModalMessage(msgEl, message);
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

  // options.danger 가 true 면 실수로 Enter 를 눌러도 실행되지 않도록 '취소'에 포커스를 둔다.
  window.showConfirm = (message, options = {}) => {
    return new Promise((resolve) => {
      const modal = document.getElementById('custom-confirm-modal');
      const msgEl = document.getElementById('confirm-message');
      const yesBtn = document.getElementById('confirm-yes-btn');
      const noBtn = document.getElementById('confirm-no-btn');
      if (!modal || !msgEl || !yesBtn || !noBtn) {
        resolve(confirm(message));
        return;
      }
      renderModalMessage(msgEl, message);
      yesBtn.textContent = options.confirmLabel || '확인';
      yesBtn.classList.toggle('btn-danger', options.danger !== false);
      yesBtn.classList.toggle('btn-confirm-primary', options.danger === false);

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
