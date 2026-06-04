import '../style.css';
import { createSupabaseClient } from './services/supabaseClient.js';
import { installModalHandlers } from './shared/modal.js';
import { initTheme } from './shared/theme.js';
import { renderVersionLabels } from './shared/version.js';

installModalHandlers();
initTheme();

const supabaseClient = createSupabaseClient();

document.addEventListener('DOMContentLoaded', async () => {
    renderVersionLabels();
    const currentPage = window.location.pathname.split('/').pop();

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            if (currentPage === 'login.html' || currentPage === '') toggleView('update-password');
        }
    });

    const { data: { session } } = await supabaseClient.auth.getSession();

    if (currentPage === 'login.html' || currentPage === '') {
        if (session && !window.location.hash.includes('type=recovery')) {
            window.location.replace('index.html');
            return;
        }

        const savedEmail = localStorage.getItem('savedDailyDashEmail');
        const loginEmailInput = document.getElementById('loginEmail');
        const rememberCheckbox = document.getElementById('rememberEmail');
        
        if (savedEmail && loginEmailInput) {
            loginEmailInput.value = savedEmail;
            rememberCheckbox.checked = true;
        }

        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = loginEmailInput.value.trim();
                const password = document.getElementById('loginPassword').value;
                const loginBtn = document.getElementById('loginBtn');

                if (rememberCheckbox.checked) localStorage.setItem('savedDailyDashEmail', email);
                else localStorage.removeItem('savedDailyDashEmail');

                const originalText = loginBtn.innerHTML;
                loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리중...';
                loginBtn.disabled = true;

                const { data: signInData, error } = await supabaseClient.auth.signInWithPassword({ email, password });

                if (error) {
                    await window.showAlert("로그인 실패: 비밀번호가 틀렸거나 없는 계정입니다.");
                    loginBtn.innerHTML = originalText;
                    loginBtn.disabled = false;
                } else if (signInData && signInData.user) {
                    if (signInData.user.email !== 'eowert72@gmail.com') {
                        const { data: appv } = await supabaseClient.from('user_approvals').select('is_approved').eq('email', signInData.user.email).single();
                        if (!appv || !appv.is_approved) {
                            await window.showAlert("⚠️ 아직 가입 승인이 완료되지 않은 계정입니다.<br>최고 관리자의 가입 승인을 기다려주세요.");
                            await supabaseClient.auth.signOut();
                            loginBtn.innerHTML = originalText;
                            loginBtn.disabled = false;
                            return;
                        }
                    }
                    window.location.replace('index.html');
                }
            });
        }

        const signupForm = document.getElementById('signupForm');
        if (signupForm) {
            signupForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('signupEmail').value.trim();
                const password = document.getElementById('signupPassword').value;
                const confirmPassword = document.getElementById('signupConfirmPassword').value;
                const signupBtn = document.getElementById('signupBtn');

                if (password !== confirmPassword) {
                    await window.showAlert("⚠️ 입력하신 두 비밀번호가 일치하지 않습니다.<br>다시 확인해 주세요.");
                    return;
                }

                const originalText = signupBtn.innerHTML;
                signupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 가입중...';
                signupBtn.disabled = true;

                const { data: signUpData, error } = await supabaseClient.auth.signUp({ email, password });

                if (error) {
                    await window.showAlert("회원가입 실패: " + error.message);
                    signupBtn.innerHTML = originalText;
                    signupBtn.disabled = false;
                } else if (signUpData && signUpData.user) {
                    
                    const { error: insertError } = await supabaseClient.from('user_approvals').insert([{ email: email, is_approved: false }]);
                    
                    if (insertError) {
                        await window.showAlert("⚠️ 계정은 생성되었으나, 대기열 명단 등록에 실패했습니다.<br>(Supabase 권한 문제): " + insertError.message);
                        signupBtn.innerHTML = originalText;
                        signupBtn.disabled = false;
                        return;
                    }
                    
                    await window.showAlert("회원가입 신청이 안전하게 완료되었습니다!<br>최고 관리자의 승인 완료 후 대시보드 로그인이 가능합니다.");
                    toggleView('login');
                    document.getElementById('loginEmail').value = email;
                    signupForm.reset();
                    signupBtn.innerHTML = originalText;
                    signupBtn.disabled = false;
                }
            });
        }

        const resetForm = document.getElementById('resetForm');
        if (resetForm) {
            resetForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('resetEmail').value.trim();
                const resetBtn = document.getElementById('resetBtn');

                const originalText = resetBtn.innerHTML;
                resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 발송중...';
                resetBtn.disabled = true;

                const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin + window.location.pathname, 
                });

                resetBtn.innerHTML = originalText;
                resetBtn.disabled = false;

                if (error) await window.showAlert("발송 실패: " + error.message);
                else {
                    await window.showAlert("가입하신 이메일로 비밀번호 재설정 링크를 발송했습니다.<br>메일함을 확인해 주세요.");
                    toggleView('login');
                    resetForm.reset();
                }
            });
        }

        const updatePasswordForm = document.getElementById('updatePasswordForm');
        if (updatePasswordForm) {
            updatePasswordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newPassword = document.getElementById('newPassword').value;
                const updatePwdBtn = document.getElementById('updatePwdBtn');
                
                const originalText = updatePwdBtn.innerHTML;
                updatePwdBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 변경중...';
                updatePwdBtn.disabled = true;

                const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

                if (error) {
                    await window.showAlert("비밀번호 변경 실패: " + error.message);
                    updatePwdBtn.innerHTML = originalText;
                    updatePwdBtn.disabled = false;
                } else {
                    await window.showAlert("비밀번호가 성공적으로 변경되었습니다!<br>메인 화면으로 이동합니다.");
                    window.location.replace('index.html');
                }
            });
        }

    } else {
        if (!session) window.location.replace('login.html');
    }
});

window.logout = async () => {
    if (await window.showConfirm("로그아웃 하시겠습니까?")) {
        await supabaseClient.auth.signOut();
        window.location.replace('login.html');
    }
};
