import '../style.css';
import { api, getCurrentUser } from './services/api.js';
import { setIcon } from './shared/icons.js';
import { installModalHandlers } from './shared/modal.js';
import { initTheme, resolveTheme, toggleTheme } from './shared/theme.js';
import { renderVersionLabels } from './shared/version.js';

installModalHandlers();
initTheme();

const REMEMBER_EMAIL_KEY = 'savedDailyDashEmail';
const VIEWS = ['login', 'signup', 'reset', 'update-password'];

let resetToken = '';
let emailResetEnabled = true;

function toggleView(viewName) {
    VIEWS.forEach((name) => {
        document.getElementById(`${name}-view`)?.classList.toggle('hidden-view', name !== viewName);
    });
    if (viewName === 'reset') applyResetAvailability();
    document.querySelector(`#${viewName}-view input`)?.focus();
}

function applyResetAvailability() {
    document.getElementById('resetDisabledNotice')?.classList.toggle('hidden-view', emailResetEnabled);
    document.getElementById('resetForm')?.classList.toggle('hidden-view', !emailResetEnabled);
    document.getElementById('resetSubtitle')?.classList.toggle('hidden-view', !emailResetEnabled);
}

function setButtonLoading(button, label) {
    const originalHtml = button.innerHTML;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label}`;
    button.disabled = true;
    return () => {
        button.innerHTML = originalHtml;
        button.disabled = false;
    };
}

// 입력칸 아래에 오류를 보여준다. 다시 입력하면 지운다.
function showFieldError(fieldId, supportId, message) {
    const field = document.getElementById(fieldId);
    const support = document.getElementById(supportId);
    field?.classList.add('has-error');
    if (support) {
        support.textContent = message;
        support.classList.add('is-error');
    }
    field?.querySelector('input')?.focus();
}

function clearFieldError(fieldId, supportId) {
    document.getElementById(fieldId)?.classList.remove('has-error');
    const support = document.getElementById(supportId);
    if (support) {
        support.textContent = '';
        support.classList.remove('is-error');
    }
}

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 아이디 저장만 생략한다.
    }
}

function paintThemeToggle() {
    const button = document.getElementById('themeToggleBtn');
    if (!button) return;
    const dark = resolveTheme() === 'dark';
    setIcon(button, dark ? 'sun' : 'moon');
    button.setAttribute('aria-label', dark ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기');
    button.title = button.getAttribute('aria-label');
}

function bindStaticControls() {
    document.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', () => toggleView(button.dataset.view));
    });

    document.querySelectorAll('[data-toggle-password]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.togglePassword);
            if (!input) return;
            const reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password';
            setIcon(button, reveal ? 'eye-slash' : 'eye');
            button.setAttribute('aria-label', reveal ? '비밀번호 숨기기' : '비밀번호 보기');
        });
    });

    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
        toggleTheme();
        paintThemeToggle();
    });
    paintThemeToggle();
}

function bindLoginForm() {
    const form = document.getElementById('loginForm');
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const rememberCheckbox = document.getElementById('rememberEmail');
    const loginBtn = document.getElementById('loginBtn');

    const savedEmail = readStorage(REMEMBER_EMAIL_KEY);
    if (savedEmail) {
        emailInput.value = savedEmail;
        rememberCheckbox.checked = true;
        passwordInput.focus();
    }

    passwordInput.addEventListener('input', () => clearFieldError('loginPasswordField', 'loginError'));
    emailInput.addEventListener('input', () => clearFieldError('loginPasswordField', 'loginError'));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) {
            showFieldError('loginPasswordField', 'loginError', '이메일과 비밀번호를 모두 입력해 주세요.');
            return;
        }
        writeStorage(REMEMBER_EMAIL_KEY, rememberCheckbox.checked ? email : null);

        const restore = setButtonLoading(loginBtn, '확인 중...');
        try {
            await api.login(email, password);
            window.location.replace('index.html');
        } catch (err) {
            restore();
            if (err.code === 'PENDING_APPROVAL') {
                await window.showAlert('아직 가입 승인 전이에요\n관리자가 승인하면 바로 로그인할 수 있습니다.', { icon: 'clock' });
            } else if (err.code === 'NETWORK_ERROR') {
                await window.showAlert(`서버에 연결할 수 없어요\n${err.message}`, { tone: 'danger', icon: 'offline' });
            } else {
                showFieldError('loginPasswordField', 'loginError', err.message);
                passwordInput.select();
            }
        }
    });
}

function bindSignupForm() {
    const form = document.getElementById('signupForm');
    const signupBtn = document.getElementById('signupBtn');
    const confirmInput = document.getElementById('signupConfirmPassword');
    confirmInput.addEventListener('input', () => clearFieldError('signupConfirmField', 'signupError'));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;

        if (!email || password.length < 8) {
            showFieldError('signupConfirmField', 'signupError', '이메일과 8자 이상의 비밀번호를 입력해 주세요.');
            return;
        }
        if (password !== confirmInput.value) {
            showFieldError('signupConfirmField', 'signupError', '두 비밀번호가 일치하지 않아요.');
            return;
        }

        const restore = setButtonLoading(signupBtn, '신청 중...');
        try {
            const user = await api.signup(email, password);
            restore();
            if (user.status === 'approved') {
                await window.showAlert('관리자 계정으로 가입되었어요\n바로 로그인할 수 있습니다.', { tone: 'success' });
            } else {
                await window.showAlert('가입 신청이 완료되었어요\n관리자가 승인하면 로그인할 수 있습니다.', { tone: 'success' });
            }
            form.reset();
            toggleView('login');
            document.getElementById('loginEmail').value = email;
            document.getElementById('loginPassword').focus();
        } catch (err) {
            restore();
            showFieldError('signupConfirmField', 'signupError', err.message);
        }
    });
}

function bindResetForm() {
    const form = document.getElementById('resetForm');
    const resetBtn = document.getElementById('resetBtn');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('resetEmail').value.trim();
        const restore = setButtonLoading(resetBtn, '보내는 중...');
        try {
            await api.requestPasswordReset(email);
            restore();
            await window.showAlert('재설정 링크를 보냈어요\n가입하신 이메일의 메일함을 확인해 주세요.', { tone: 'success', icon: 'mail' });
            form.reset();
            toggleView('login');
        } catch (err) {
            restore();
            if (err.code === 'MAIL_DISABLED') {
                emailResetEnabled = false;
                applyResetAvailability();
                return;
            }
            await window.showAlert(`발송 실패\n${err.message}`);
        }
    });
}

function bindUpdatePasswordForm() {
    const form = document.getElementById('updatePasswordForm');
    const updateBtn = document.getElementById('updatePwdBtn');
    const confirmInput = document.getElementById('newPasswordConfirm');
    confirmInput.addEventListener('input', () => clearFieldError('newPasswordConfirmField', 'updatePasswordError'));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const newPassword = document.getElementById('newPassword').value;
        if (newPassword.length < 8) {
            showFieldError('newPasswordConfirmField', 'updatePasswordError', '비밀번호는 8자 이상이어야 해요.');
            return;
        }
        if (newPassword !== confirmInput.value) {
            showFieldError('newPasswordConfirmField', 'updatePasswordError', '두 비밀번호가 일치하지 않아요.');
            return;
        }

        const restore = setButtonLoading(updateBtn, '변경 중...');
        try {
            await api.confirmPasswordReset(resetToken, newPassword);
            restore();
            resetToken = '';
            form.reset();
            await window.showAlert('비밀번호를 바꿨어요\n새 비밀번호로 로그인해 주세요.', { tone: 'success' });
            toggleView('login');
        } catch (err) {
            restore();
            showFieldError('newPasswordConfirmField', 'updatePasswordError', err.message);
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    renderVersionLabels();
    bindStaticControls();
    bindLoginForm();
    bindSignupForm();
    bindResetForm();
    bindUpdatePasswordForm();

    api.authOptions()
        .then((options) => {
            emailResetEnabled = Boolean(options.emailPasswordReset);
        })
        .catch(() => {});

    // 메일로 받은 재설정 링크: login.html#reset=토큰
    const resetMatch = window.location.hash.match(/reset=([A-Za-z0-9_-]+)/);
    if (resetMatch) {
        resetToken = resetMatch[1];
        history.replaceState(null, '', window.location.pathname);
        toggleView('update-password');
        return;
    }

    try {
        const user = await getCurrentUser({ redirectOnUnauthorized: false });
        if (user.status === 'approved') window.location.replace('index.html');
    } catch {
        // 로그인 전 상태 - 로그인 화면을 그대로 보여준다.
    }
});
