import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { cleanupExpiredTokens, isAllowedCrossOrigin, loadSession } from './auth.js';
import { config, isMailEnabled } from './config.js';
import { pool, runMigrations, waitForDatabase } from './db.js';
import { HttpError } from './http.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import reportRoutes from './routes/reports.js';
import transactionRoutes from './routes/transactions.js';

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin'
  });
  next();
});

const api = express.Router();

// CORS: ALLOWED_ORIGINS 에 등록된 화면(GitHub Pages 등)에서만 API 를 부를 수 있다.
api.use((req, res, next) => {
  if (isAllowedCrossOrigin(req)) {
    res.set({
      'Access-Control-Allow-Origin': req.get('origin'),
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin'
    });
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  next();
});

api.use(express.json({ limit: '100kb' }));

// CSRF 방어: 상태를 바꾸는 요청은 JSON 본문이어야 하고, 허용되지 않은 사이트에서 온 요청은 거부한다.
api.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !isAllowedCrossOrigin(req)) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = '';
    }
    if (originHost !== req.get('host')) {
      throw new HttpError(403, 'CROSS_ORIGIN', '허용되지 않은 출처의 요청입니다.');
    }
  }
  if (req.headers['content-length'] && req.headers['content-length'] !== '0' && !req.is('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 지원합니다.');
  }
  next();
});

api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

api.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, mail: isMailEnabled });
});

api.use(loadSession);
api.use('/auth', authRoutes);
api.use('/transactions', transactionRoutes);
api.use('/admin', adminRoutes);
api.use('/', reportRoutes);

api.use((req, res) => {
  throw new HttpError(404, 'NOT_FOUND', '존재하지 않는 API 입니다.');
});

app.use('/api', api);

if (existsSync(config.staticDir)) {
  // 안드로이드 앱(APK)이 주소창 없이 열리려면 이 사이트가 앱의 주인임을 assetlinks.json 으로 증명해야 한다.
  // 점(.)으로 시작하는 폴더는 기본 정적 처리에서 숨겨지므로 따로 연결한다.
  app.use(
    '/.well-known',
    express.static(path.join(config.staticDir, '.well-known'), {
      setHeaders(res) {
        res.set('Cache-Control', 'public, max-age=3600');
      }
    })
  );
  app.use(
    express.static(config.staticDir, {
      extensions: ['html'],
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) {
          // Vite 가 파일명에 해시를 붙이므로 오래 캐시해도 안전하다.
          res.set('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.set('Cache-Control', 'no-cache');
        }
      }
    })
  );
} else {
  console.warn(`[web] 정적 파일 폴더가 없습니다: ${config.staticDir} (API 만 제공합니다)`);
}

// Express 는 인자가 4개인 함수를 에러 처리기로 인식하므로 next 를 지우면 안 된다.
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: '요청 본문이 올바른 JSON 이 아닙니다.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: '요청 데이터가 너무 큽니다.' } });
  }
  // Postgres 입력 오류(형식/범위)는 사용자 입력 문제로 본다.
  if (typeof err.code === 'string' && /^(22|23)/.test(err.code)) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '입력값이 올바르지 않습니다.' } });
  }
  console.error(`[api] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } });
});

async function start() {
  await waitForDatabase();
  await runMigrations();
  await cleanupExpiredTokens();
  setInterval(() => cleanupExpiredTokens().catch((err) => console.error('[cleanup]', err)), 3_600_000).unref();

  const server = app.listen(config.port, config.host, () => {
    console.log(`[web] DailyDash 서버 실행 중: http://${config.host}:${config.port}`);
    if (!config.adminEmail) console.warn('[auth] ADMIN_EMAIL 이 설정되지 않아 관리자 자동 지정이 꺼져 있습니다.');
    if (config.allowedOrigins.length) console.log(`[web] 외부 화면 허용 출처: ${config.allowedOrigins.join(', ')}`);
    if (!isMailEnabled) console.log('[mail] SMTP 미설정 - 비밀번호 찾기는 관리자 초기화 방식으로 동작합니다.');
  });

  const shutdown = (signal) => {
    console.log(`[web] ${signal} 수신, 종료합니다.`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[web] 서버 시작 실패', err);
  process.exit(1);
});
