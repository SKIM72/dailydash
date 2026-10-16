// Iconsax 아이콘 중 DailyDash 에서 쓰는 것만 SVG 로 뽑아 src/shared/icons.generated.js 를 만든다.
// 아이콘을 추가하려면 아래 ICON_MAP 에 "앱에서 쓸 이름: [Iconsax 이름, 스타일...]" 을 넣고 `npm run icons` 를 실행한다.
// 아이콘 목록: https://iconsax.io  (무료 아이콘, 개인·상업적 사용 가능)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const Iconsax = require('iconsax-react');
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/shared/icons.generated.js');

// 기본은 Bulk(두 톤). 선택된 메뉴·강조 버튼처럼 채워진 모양이 필요한 것만 Bold 도 만든다.
const ICON_MAP = {
  // 화면 이동
  daily: ['CalendarTick', 'bulk', 'bold'],
  monthly: ['Calendar2', 'bulk', 'bold'],
  stats: ['Chart2', 'bulk', 'bold'],
  profile: ['ProfileCircle', 'bulk', 'bold'],
  menu: ['HambergerMenu', 'bold'],
  'more-vert': ['MoreCircle', 'bulk', 'bold'],
  logout: ['LogoutCurve', 'bulk'],
  login: ['LoginCurve', 'bulk'],
  shop: ['Shop', 'bulk', 'bold'],
  // 앱 설치 안내
  mobile: ['Mobile', 'bulk'],
  share: ['Export', 'bulk'],
  'add-square': ['AddSquare', 'bulk'],
  scan: ['ScanBarcode', 'bulk'],
  flash: ['Flash', 'bulk'],
  copy: ['Copy', 'bulk'],
  // 기본 동작
  add: ['Add', 'bold', 'linear'],
  'add-circle': ['AddCircle', 'bulk', 'bold'],
  edit: ['Edit2', 'bulk'],
  trash: ['Trash', 'bulk'],
  close: ['CloseCircle', 'bulk'],
  check: ['TickCircle', 'bulk', 'bold'],
  'arrow-left': ['ArrowLeft2', 'bold'],
  'arrow-right': ['ArrowRight2', 'bold'],
  'arrow-down': ['ArrowDown2', 'bold'],
  'arrow-back': ['ArrowLeft', 'bulk'],
  search: ['SearchNormal1', 'bulk'],
  refresh: ['RefreshCircle', 'bulk'],
  undo: ['ArrowRotateLeft', 'bulk'],
  save: ['Save2', 'bulk'],
  send: ['Send2', 'bulk'],
  download: ['DocumentDownload', 'bulk'],
  // 입력 / 정산
  calendar: ['Calendar1', 'bulk'],
  note: ['NoteText', 'bulk'],
  sales: ['StatusUp', 'bulk'],
  cash: ['MoneyRecive', 'bulk'],
  card: ['Card', 'bulk'],
  expense: ['MoneySend', 'bulk'],
  wallet: ['WalletMoney', 'bulk'],
  people: ['People', 'bulk'],
  receipt: ['ReceiptItem', 'bulk'],
  crown: ['Crown1', 'bulk'],
  ratio: ['ChartCircle', 'bulk'],
  'calendar-search': ['CalendarSearch', 'bulk'],
  'trend-up': ['TrendUp', 'bulk'],
  'trend-down': ['TrendDown', 'bulk'],
  // 분석
  chart: ['Chart', 'bulk'],
  graph: ['Graph', 'bulk'],
  insight: ['LampCharge', 'bulk'],
  ranking: ['Ranking', 'bulk'],
  table: ['Element3', 'bulk'],
  // 상태 / 알림
  shield: ['ShieldTick', 'bulk'],
  warning: ['Warning2', 'bulk'],
  danger: ['Danger', 'bulk'],
  info: ['InfoCircle', 'bulk'],
  offline: ['CloudCross', 'bulk'],
  clock: ['Clock', 'bulk'],
  archive: ['ArchiveBook', 'bulk'],
  // 계정 / 설정
  users: ['Profile2User', 'bulk'],
  'user-add': ['UserAdd', 'bulk'],
  'user-tick': ['UserTick', 'bulk'],
  'user-remove': ['UserRemove', 'bulk'],
  admin: ['SecurityUser', 'bulk'],
  key: ['Key', 'bulk'],
  lock: ['Lock1', 'bulk'],
  eye: ['Eye', 'bulk'],
  'eye-slash': ['EyeSlash', 'bulk'],
  mail: ['Sms', 'bulk'],
  setting: ['Setting2', 'bulk'],
  sun: ['Sun1', 'bulk'],
  moon: ['Moon', 'bulk'],
  monitor: ['Monitor', 'bulk'],
  text: ['Text', 'bulk']
};

const VARIANT_NAMES = { bulk: 'Bulk', bold: 'Bold', linear: 'Linear' };

function extractBody(component, variant) {
  const markup = renderToStaticMarkup(
    createElement(component, { variant: VARIANT_NAMES[variant], color: 'currentColor', size: 24 })
  );
  const body = markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  if (!body || markup === body) throw new Error('SVG 추출 실패');
  return body;
}

const icons = {};
for (const [name, [componentName, ...variants]] of Object.entries(ICON_MAP)) {
  const component = Iconsax[componentName];
  if (!component) throw new Error(`Iconsax 에 없는 아이콘: ${componentName} (${name})`);
  icons[name] = {};
  for (const variant of variants) icons[name][variant] = extractBody(component, variant);
}

const banner = [
  '// 자동 생성 파일입니다. 직접 고치지 말고 scripts/build-icons.mjs 를 수정한 뒤 `npm run icons` 로 다시 만드세요.',
  '// Icons: Iconsax (https://iconsax.io) - free for personal and commercial use.',
  ''
].join('\n');
writeFileSync(OUT, `${banner}export const ICONS = ${JSON.stringify(icons, null, 2)};\n`);
console.log(`아이콘 ${Object.keys(icons).length}개 생성 → ${OUT}`);
