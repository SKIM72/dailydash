export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code = 'BAD_REQUEST') => new HttpError(400, code, message);
export const notFound = (message = '대상을 찾을 수 없습니다.') => new HttpError(404, 'NOT_FOUND', message);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value, field = '날짜') {
  const text = String(value || '');
  if (!DATE_RE.test(text)) throw badRequest(`${field} 형식이 올바르지 않습니다. (YYYY-MM-DD)`);
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw badRequest(`${field}가 존재하지 않는 날짜입니다.`);
  }
  return text;
}

export function parseDateRange(startValue, endValue, maxDays = 1100) {
  const start = parseDate(startValue, '시작일');
  const end = parseDate(endValue, '종료일');
  if (start > end) throw badRequest('시작일이 종료일보다 늦을 수 없습니다.');
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
  if (days > maxDays) throw badRequest(`조회 기간은 최대 ${maxDays.toLocaleString()}일까지 가능합니다.`);
  return { start, end };
}

export function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('잘못된 ID 입니다.');
  return id;
}

export function parseAmount(value, field, { max = 1_000_000_000_000 } = {}) {
  if (value === undefined || value === null || value === '') return 0;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > max) {
    throw badRequest(`${field} 값이 올바르지 않습니다.`);
  }
  return amount;
}

export function parseText(value, field, { max = 200 } = {}) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest(`${field} 값이 올바르지 않습니다.`);
  const text = value.trim();
  if (text.length > max) throw badRequest(`${field}은(는) ${max.toLocaleString()}자 이하로 입력해 주세요.`);
  return text;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest('이메일 주소 형식이 올바르지 않습니다.');
  return email;
}

export const MIN_PASSWORD_LENGTH = 8;

export function parseNewPassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`, 'WEAK_PASSWORD');
  }
  if (password.length > 200) throw badRequest('비밀번호가 너무 깁니다.');
  return password;
}
