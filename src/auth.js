import '../style.css';
import { api, getCurrentUser } from './services/api.js';
import { installModalHandlers } from './shared/modal.js';
import { initTheme } from './shared/theme.js';
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

function setButtonLoading(button, loadingHtml) {
    const originalHtml = button.innerHTML;
    button.innerHTML = loadingHtml;
    button.disabled = true;
    return () => {
        button.innerHTML = originalHtml;
        button.disabled = false;
    };
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

function bindStaticControls() {
    document.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', () => toggleView(button.dataset.view));
    });

    document.querySelectorAll('[data-toggle-password]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.togglePassword);
            const icon = button.querySelector('i');
            if (!input) return;
            const reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password';
            icon?.classList.toggle('fa-eye', !reveal);
            icon?.classList.toggle('fa-eye-slash', reveal);
            button.setAttribute('aria-label', reveal ? '비밀번호 숨기기' : '비밀번호 보기');
        });
    });
}

function bindLoginForm() {
    const form = document.getElementById('loginForm');
    const emailInput = document.getElementById('loginEmail');
    const rememberCheckbox = document.getElementById('rememberEmail');
    const loginBtn = document.getElementById('loginBtn');

    const savedEmail = readStorage(REMEMBER_EMAIL_KEY);
    if (savedEmail) {
        emailInput.value = savedEmail;
        rememberCheckbox.checked = true;
        document.getElementById('loginPassword')?.focus();
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = emailInput.value.trim();
        const password = document.getElementById('loginPassword').value;
        writeStorage(REMEMBER_EMAIL_KEY, rememberCheckbox.checked ? email : null);

        const restore = setButtonLoading(loginBtn, '<i class="fas fa-spinner fa-spin"></i> 처리중...');
        try {
            await api.login(email, password);
            window.location.replace('index.html');
        } catch (err) {
            restore();
            if (err.code === 'PENDING_APPROVAL') {
                await window.showAlert('⚠️ 아직 가입 승인이 완료되지 않은 계정입니다.<br>최고 관리자의 가입 승인을 기다려주세요.');
            } else {
                await window.showAlert(`로그인 실패: ${err.message}`);
            }
        }
    });
}

function bindSignupForm() {
    const form = document.getElementById('signupForm');
    const signupBtn = document.getElementById('signupBtn');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const confirmPassword = document.getElementById('signupConfirmPassword').value;

        if (password !== confirmPassword) {
            await window.showAlert('⚠️ 입력하신 두 비밀번호가 일치하지 않습니다.<br>다시 확인해 주세요.');
            return;
        }

        const restore = setButtonLoading(signupBtn, '<i class="fas fa-spinner fa-spin"></i> 가입중...');
        try {
            const user = await api.signup(email, password);
            restore();
            if (user.status === 'approved') {
                await window.showAlert('관리자 계정으로 가입되었습니다.<br>바로 로그인할 수 있습니다.');
            } else {
                await window.showAlert('회원가입 신청이 안전하게 완료되었습니다!<br>최고 관리자의 승인 완료 후 대시보드 로그인이 가능합니다.');
            }
            form.reset();
            toggleView('login');
            document.getElementById('loginEmail').value = email;
            document.getElementById('loginPassword').focus();
        } catch (err) {
            restore();
            await window.showAlert(`회원가입 실패: ${err.message}`);
        }
    });
}

function bindResetForm() {
    const form = document.getElementById('resetForm');
    const resetBtn = document.getElementById('resetBtn');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('resetEmail').value.trim();
        const restore = setButtonLoading(resetBtn, '<i class="fas fa-spinner fa-spin"></i> 발송중...');
        try {
            await api.requestPasswordReset(email);
            restore();
            await window.showAlert('가입하신 이메일로 비밀번호 재설정 링크를 발송했습니다.<br>메일함을 확인해 주세요.');
            form.reset();
            toggleView('login');
        } catch (err) {
            restore();
            if (err.code === 'MAIL_DISABLED') {
                emailResetEnabled = false;
                applyResetAvailability();
                return;
            }
            await window.showAlert(`발송 실패: ${err.message}`);
        }
    });
}

function bindUpdatePasswordForm() {
    const form = document.getElementById('updatePasswordForm');
    const updateBtn = document.getElementById('updatePwdBtn');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('newPasswordConfirm').value;
        if (newPassword !== confirmPassword) {
            await window.showAlert('⚠️ 입력하신 두 비밀번호가 일치하지 않습니다.');
            return;
        }

        const restore = setButtonLoading(updateBtn, '<i class="fas fa-spinner fa-spin"></i> 변경중...');
        try {
            await api.confirmPasswordReset(resetToken, newPassword);
            restore();
            resetToken = '';
            form.reset();
            await window.showAlert('비밀번호가 성공적으로 변경되었습니다!<br>새 비밀번호로 로그인해 주세요.');
            toggleView('login');
        } catch (err) {
            restore();
            await window.showAlert(`비밀번호 변경 실패: ${err.message}`);
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
