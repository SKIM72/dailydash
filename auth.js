const SUPABASE_URL = 'https://lbwlodnguwuudbbaqmuz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxid2xvZG5ndXd1dWRiYmFxbXV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjg2NjQsImV4cCI6MjA5NDYwNDY2NH0.YJ3zbTthU2aGDCAfnk1GWeuI2nj4VM8qLAKXyaNITPQ';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    
    // 현재 페이지 파일명 확인
    const currentPage = window.location.pathname.split('/').pop();

    // 1. 현재 로그인 상태 확인 (자동 로그인 유지)
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (currentPage === 'login.html' || currentPage === '') {
        // 이미 로그인된 상태라면 메인으로 강제 이동
        if (session) {
            window.location.replace('index.html');
            return;
        }

        // --- 아이디(이메일) 저장 기능 세팅 ---
        const savedEmail = localStorage.getItem('savedDailyDashEmail');
        const loginEmailInput = document.getElementById('loginEmail');
        const rememberCheckbox = document.getElementById('rememberEmail');
        
        if (savedEmail && loginEmailInput) {
            loginEmailInput.value = savedEmail;
            rememberCheckbox.checked = true;
        }

        // --- 1. 로그인 폼 제출 ---
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const email = loginEmailInput.value.trim();
                const password = document.getElementById('loginPassword').value;
                const loginBtn = document.getElementById('loginBtn');

                // 아이디 저장 로직 처리
                if (rememberCheckbox.checked) {
                    localStorage.setItem('savedDailyDashEmail', email);
                } else {
                    localStorage.removeItem('savedDailyDashEmail');
                }

                const originalText = loginBtn.innerHTML;
                loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리중...';
                loginBtn.disabled = true;

                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email: email, password: password
                });

                if (error) {
                    alert("로그인 실패: " + error.message);
                    loginBtn.innerHTML = originalText;
                    loginBtn.disabled = false;
                } else {
                    window.location.replace('index.html');
                }
            });
        }

        // --- 2. 회원가입 폼 제출 ---
        const signupForm = document.getElementById('signupForm');
        if (signupForm) {
            signupForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('signupEmail').value.trim();
                const password = document.getElementById('signupPassword').value;
                const signupBtn = document.getElementById('signupBtn');

                const originalText = signupBtn.innerHTML;
                signupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 가입중...';
                signupBtn.disabled = true;

                const { data, error } = await supabaseClient.auth.signUp({
                    email: email, password: password
                });

                signupBtn.innerHTML = originalText;
                signupBtn.disabled = false;

                if (error) {
                    alert("회원가입 실패: " + error.message);
                } else {
                    alert("회원가입이 완료되었습니다! (이메일 인증을 설정하셨다면 메일함을 확인해 주세요.)\n바로 로그인해 보세요.");
                    toggleView('login');
                    document.getElementById('loginEmail').value = email;
                    document.getElementById('signupForm').reset();
                }
            });
        }

        // --- 3. 비밀번호 찾기 폼 제출 ---
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
                    redirectTo: window.location.origin + '/index.html', // 변경 완료 후 돌아올 주소
                });

                resetBtn.innerHTML = originalText;
                resetBtn.disabled = false;

                if (error) {
                    alert("발송 실패: " + error.message);
                } else {
                    alert("가입하신 이메일로 비밀번호 재설정 링크를 발송했습니다. 메일함을 확인해 주세요.");
                    toggleView('login');
                    document.getElementById('resetForm').reset();
                }
            });
        }

    } else {
        // 메인 페이지(index.html) 보호 로직
        if (!session) {
            window.location.replace('login.html');
        }
    }
});

// 전역 로그아웃 기능
window.logout = async () => {
    if (confirm("로그아웃 하시겠습니까?")) {
        await supabaseClient.auth.signOut();
        window.location.replace('login.html');
    }
};