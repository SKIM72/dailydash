import { createSupabaseClient } from './services/supabaseClient.js';

(async () => {
  const sb = createSupabaseClient();
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    window.location.replace('login.html');
    return;
  }

  if (session.user.email !== 'eowert72@gmail.com') {
    const { data: appv } = await sb
      .from('user_approvals')
      .select('is_approved')
      .eq('email', session.user.email)
      .single();

    if (!appv || !appv.is_approved) {
      alert('아직 가입 승인이 완료되지 않은 계정입니다. 최고 관리자의 승인을 기다려주세요.');
      await sb.auth.signOut();
      window.location.replace('login.html');
    }
  }
})();
