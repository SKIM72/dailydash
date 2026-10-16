// 오프라인 입력 보관함: 인터넷이 끊겨 서버에 못 보낸 새 내역을 휴대폰(localStorage)에 모아 두었다가 연결되면 보낸다.
// 내역마다 고유 번호(client_id)를 붙여, 응답만 못 받고 다시 보내도 서버에 두 번 저장되지 않는다.
const KEY = 'dailydash-outbox-v1';
export const OUTBOX_EVENT = 'dailydash:outbox';

export function newClientId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  // 보안 연결(https)이 아닌 개발 환경용
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readAll() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeAll(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('오프라인 보관함 저장 실패', err);
  }
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { count: items.length } }));
}

// 다른 계정이 같은 휴대폰을 쓰면 섞이지 않도록 계정별로 나눠 본다.
export function readOutbox(owner) {
  return readAll().filter((item) => item.owner === owner);
}

export function addToOutbox(owner, values) {
  writeAll([...readAll(), { owner, values, queuedAt: new Date().toISOString(), error: null }]);
}

export function removeFromOutbox(clientId) {
  writeAll(readAll().filter((item) => item.values.client_id !== clientId));
}

function markError(clientId, message) {
  writeAll(readAll().map((item) => (item.values.client_id === clientId ? { ...item, error: message } : item)));
}

let flushing = null;

// send(values) 로 하나씩 보낸다. 연결이 다시 끊기면 멈추고, 내용 문제(4xx)는 표시만 해 두고 다음으로 넘어간다.
// 이미 보내는 중이면(연결 복구 신호가 겹친 경우) 기다리기만 하고 결과는 null 로 돌려 안내가 두 번 뜨지 않게 한다.
export function flushOutbox(owner, send) {
  if (flushing) return flushing.then(() => null);
  flushing = (async () => {
    let sent = 0;
    let failed = 0;
    for (const item of readOutbox(owner)) {
      try {
        await send(item.values);
        removeFromOutbox(item.values.client_id);
        sent += 1;
      } catch (err) {
        if (err.code === 'NETWORK_ERROR' || !err.status || err.status >= 500) break;
        if (err.status === 401) break;
        markError(item.values.client_id, err.message);
        failed += 1;
      }
    }
    return { sent, failed, remaining: readOutbox(owner).length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
