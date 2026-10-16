import { ICONS } from './icons.generated.js';

// Iconsax 아이콘 SVG 를 만든다. 색은 글자색(currentColor)을 따른다.
// HTML 에서는 <i data-icon="이름" data-variant="bold" class="..."></i> 로 쓰면 빌드 때 SVG 로 바뀐다. (vite.config.js)
export function iconSvg(name, { variant = 'bulk', className = '', label = '' } = {}) {
  const set = ICONS[name];
  if (!set) throw new Error(`없는 아이콘: ${name}`);
  const body = set[variant] || set.bulk || set.bold;
  const classes = ['icon', className].filter(Boolean).join(' ');
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" focusable="false" ${a11y}>${body}</svg>`;
}

export function iconElement(name, options) {
  const template = document.createElement('template');
  template.innerHTML = iconSvg(name, options);
  return template.content.firstElementChild;
}

// 이미 그려진 아이콘을 다른 아이콘으로 바꾼다. (비밀번호 보기 토글, 선택 상태 등)
export function setIcon(target, name, options) {
  const svg = target?.matches?.('svg.icon') ? target : target?.querySelector('svg.icon');
  if (svg) svg.replaceWith(iconElement(name, options));
  else target?.prepend(iconElement(name, options));
}
