export const SUPABASE_URL = 'https://lbwlodnguwuudbbaqmuz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxid2xvZG5ndXd1dWRiYmFxbXV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjg2NjQsImV4cCI6MjA5NDYwNDY2NH0.YJ3zbTthU2aGDCAfnk1GWeuI2nj4VM8qLAKXyaNITPQ';

export function createSupabaseClient() {
  if (!window.supabase?.createClient) {
    throw new Error('Supabase 라이브러리가 로드되지 않았습니다.');
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
