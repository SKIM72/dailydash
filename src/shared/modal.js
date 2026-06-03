export function renderModalMessage(target, message) {
  target.replaceChildren();
  String(message).split(/<br\s*\/?>|\n/i).forEach((part, index) => {
    if (index > 0) target.appendChild(document.createElement('br'));
    target.appendChild(document.createTextNode(part));
  });
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
      modal.classList.remove('hidden-view');
      const handleOk = () => {
        modal.classList.add('hidden-view');
        okBtn.removeEventListener('click', handleOk);
        resolve();
      };
      okBtn.addEventListener('click', handleOk);
    });
  };

  window.showConfirm = (message) => {
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
      modal.classList.remove('hidden-view');
      const cleanUp = () => {
        modal.classList.add('hidden-view');
        yesBtn.removeEventListener('click', handleYes);
        noBtn.removeEventListener('click', handleNo);
      };
      const handleYes = () => { cleanUp(); resolve(true); };
      const handleNo = () => { cleanUp(); resolve(false); };
      yesBtn.addEventListener('click', handleYes);
      noBtn.addEventListener('click', handleNo);
    });
  };
}
