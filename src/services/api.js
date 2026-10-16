// 자체 서버 API 호출 래퍼.
// - 화면과 API 가 같은 주소: 로그인 상태를 httpOnly 쿠키로 유지한다.
// - 화면은 GitHub Pages, API 는 집 서버처럼 주소가 다르면(VITE_API_BASE_URL 지정):
//   서버가 준 토큰을 localStorage 에 두고 Authorization 헤더로 보낸다.

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const USE_TOKEN = Boolean(API_BASE) && new URL(API_BASE, window.location.href).origin !== window.location.origin;
const TOKEN_KEY = 'dailydash-session-token';

function readToken() {
  if (!USE_TOKEN) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 저장소를 못 쓰는 환경이면 이번 페이지에서만 로그인 상태가 유지된다.
  }
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const LOGIN_PAGE = 'login.html';

// 서버 연결 상태가 바뀔 때 화면에 알린다. (집 서버가 꺼져 있으면 배너를 띄우기 위함)
let serverReachable = true;
function setServerReachable(reachable) {
  if (serverReachable === reachable) return;
  serverReachable = reachable;
  window.dispatchEvent(new CustomEvent('dailydash:network', { detail: { reachable } }));
}

async function request(method, path, { body, redirectOnUnauthorized = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    setServerReachable(false);
    throw new ApiError('서버에 연결할 수 없습니다. 서버가 켜져 있는지, 인터넷 연결을 확인해 주세요.', { code: 'NETWORK_ERROR' });
  }
  setServerReachable(true);
  if (response.status === 401 && token) writeToken(null);

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const code = data?.error?.code || `HTTP_${response.status}`;
    const message = data?.error?.message || `요청을 처리하지 못했습니다. (${response.status})`;
    if (response.status === 401 && redirectOnUnauthorized) {
      window.location.replace(LOGIN_PAGE);
    }
    throw new ApiError(message, { status: response.status, code });
  }
  return data;
}

const get = (path, options) => request('GET', path, options);
const post = (path, body, options) => request('POST', path, { ...options, body: body ?? {} });
const put = (path, body) => request('PUT', path, { body });
const patch = (path, body) => request('PATCH', path, { body });
const del = (path) => request('DELETE', path);

let currentUserPromise = null;

// 같은 페이지 안에서 여러 번 불러도 /auth/me 는 한 번만 호출한다.
export function getCurrentUser({ refresh = false, redirectOnUnauthorized = true } = {}) {
  // 토큰 방식인데 저장된 토큰이 없으면 서버에 묻지 않아도 로그인 전 상태다.
  if (USE_TOKEN && !readToken()) {
    if (redirectOnUnauthorized) window.location.replace(LOGIN_PAGE);
    return Promise.reject(new ApiError('로그인이 필요합니다.', { status: 401, code: 'UNAUTHENTICATED' }));
  }
  if (!currentUserPromise || refresh) {
    currentUserPromise = get('/auth/me', { redirectOnUnauthorized })
      .then((data) => data.user)
      .catch((err) => {
        currentUserPromise = null;
        throw err;
      });
  }
  return currentUserPromise;
}

const qs = (params) => new URLSearchParams(params).toString();

export const api = {
  // 인증
  authOptions: () => get('/auth/options', { redirectOnUnauthorized: false }),
  login: (email, password) => post('/auth/login', { email, password }, { redirectOnUnauthorized: false }).then((data) => {
    if (USE_TOKEN) {
      if (!data.token) {
        throw new ApiError('서버의 ALLOWED_ORIGINS 에 이 화면 주소가 등록되어 있지 않습니다. 관리자에게 문의해 주세요.', { code: 'ORIGIN_NOT_ALLOWED' });
      }
      writeToken(data.token);
    }
    return data.user;
  }),
  logout: () => post('/auth/logout', {}, { redirectOnUnauthorized: false }).finally(() => writeToken(null)),
  signup: (email, password) => post('/auth/signup', { email, password }, { redirectOnUnauthorized: false }).then((data) => data.user),
  changePassword: (currentPassword, newPassword) => post('/auth/password', { currentPassword, newPassword }),
  requestPasswordReset: (email) => post('/auth/password-reset/request', { email }, { redirectOnUnauthorized: false }),
  confirmPasswordReset: (token, newPassword) => post('/auth/password-reset/confirm', { token, newPassword }, { redirectOnUnauthorized: false }),

  // 정산 내역
  listTransactionsByDate: (date) => get(`/transactions?${qs({ date })}`).then((data) => data.transactions),
  listTransactionsInRange: (start, end) => get(`/transactions?${qs({ start, end })}`).then((data) => data.transactions),
  createTransaction: (values) => post('/transactions', values).then((data) => data.transaction),
  updateTransaction: (id, values) => patch(`/transactions/${id}`, values).then((data) => data.transaction),
  deleteTransaction: (id) => del(`/transactions/${id}`).then((data) => data.transaction),
  restoreTransaction: (id) => post(`/transactions/${id}/restore`).then((data) => data.transaction),

  // 특기사항 / 통계 / 이력
  getNote: (date) => get(`/notes/${date}`).then((data) => data.note),
  saveNote: (date, specialNote) => put(`/notes/${date}`, { special_note: specialNote }).then((data) => data.note),
  dailySummary: (start, end) => get(`/summary/daily?${qs({ start, end })}`).then((data) => data.days),
  auditLogs: (limit = 30) => get(`/audit-logs?${qs({ limit })}`).then((data) => data.logs),
  logExport: (label, details) => post('/audit-logs/export', { label, details }),

  // AI 월간 리포트 (Gemini) - 만들기는 관리자만
  aiStatus: () => get('/ai/status'),
  getMonthlyAiReport: (month) => get(`/ai/monthly-report?${qs({ month })}`).then((data) => data.report),
  createMonthlyAiReport: (month) => post('/ai/monthly-report', { month }),

  // 관리자
  listUsers: () => get('/admin/users').then((data) => data.users),
  approveUser: (id) => post(`/admin/users/${id}/approve`).then((data) => data.user),
  disableUser: (id) => post(`/admin/users/${id}/disable`).then((data) => data.user),
  resetUserPassword: (id) => post(`/admin/users/${id}/reset-password`),
  deleteUser: (id) => del(`/admin/users/${id}`)
};
