import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = process.env;

function toBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toOriginList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((item) => new URL(item).origin);
}

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  databaseUrl: env.DATABASE_URL || 'postgres://dailydash:dailydash@127.0.0.1:5432/dailydash',
  // 이 이메일로 가입/이전된 계정은 자동으로 관리자 권한을 받는다.
  adminEmail: String(env.ADMIN_EMAIL || '').trim().toLowerCase(),
  // 비밀번호 재설정 메일 링크에 쓰이는 화면 주소 (예: https://계정.github.io/저장소)
  appUrl: String(env.APP_URL || '').replace(/\/+$/, ''),
  // 화면을 다른 주소(GitHub Pages 등)에서 띄울 때 API 호출을 허용할 출처 목록 (쉼표 구분)
  allowedOrigins: toOriginList(env.ALLOWED_ORIGINS),
  staticDir: env.STATIC_DIR || resolve(__dirname, '../../dist'),
  sessionDays: Number(env.SESSION_DAYS || 30),
  // auto: HTTPS 요청일 때만 Secure 쿠키를 붙인다 (Caddy 뒤에서는 항상 HTTPS)
  cookieSecure: env.COOKIE_SECURE || 'auto',
  trustProxy: toBool(env.TRUST_PROXY, true),
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: toBool(env.SMTP_SECURE, Number(env.SMTP_PORT) === 465),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || env.SMTP_USER || ''
  }
};

export const isMailEnabled = Boolean(config.smtp.host && config.smtp.from);
