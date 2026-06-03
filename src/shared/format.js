export function formatCommas(val) {
  const num = String(val).replace(/[^0-9]/g, '');
  return num ? Number(num).toLocaleString() : '';
}

export function parseCommas(val) {
  return parseInt(String(val).replace(/[^0-9]/g, ''), 10) || 0;
}

export function formatWon(value) {
  return `${(value || 0).toLocaleString()}원`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value)}%`;
}
