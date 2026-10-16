// 공용 UI 동작: 메뉴 · 내비게이션 드로어 · 바텀시트 · 탭

const MOBILE_QUERY = '(max-width: 1023px)';

export function isMobileLayout() {
  return window.matchMedia?.(MOBILE_QUERY).matches ?? false;
}

function isDialogOpen() {
  return Boolean(document.querySelector('.modal-overlay:not(.hidden-view)'));
}

/* ---------------- 메뉴 ---------------- */
let openMenuState = null;

function closeMenu({ restoreFocus = false } = {}) {
  if (!openMenuState) return;
  const { menu, trigger, dynamic } = openMenuState;
  openMenuState = null;
  trigger?.setAttribute('aria-expanded', 'false');
  if (dynamic) menu.remove();
  else menu.hidden = true;
  if (restoreFocus) trigger?.focus();
}

function focusMenuItem(menu, index) {
  const items = [...menu.querySelectorAll('.menu-item:not([disabled])')];
  if (!items.length) return;
  items[(index + items.length) % items.length].focus();
}

function openMenu(menu, trigger, { dynamic = false } = {}) {
  closeMenu();
  openMenuState = { menu, trigger, dynamic, scrollY: window.scrollY };
  trigger?.setAttribute('aria-expanded', 'true');
  menu.hidden = false;
  focusMenuItem(menu, 0);
}

// 버튼 옆에 동작 메뉴를 띄운다. items: [{ label, icon(svg 문자열), danger, onSelect }]
export function showActionMenu(trigger, items) {
  if (openMenuState?.trigger === trigger) {
    closeMenu();
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `menu-item${item.danger ? ' menu-item--danger' : ''}`;
    button.setAttribute('role', 'menuitem');
    button.innerHTML = item.icon || '';
    button.append(item.label);
    button.addEventListener('click', () => {
      closeMenu();
      item.onSelect();
    });
    menu.appendChild(button);
  });
  document.body.appendChild(menu);

  // 화면 기준으로 위치를 잡고, 아래 공간이 부족하면 위로 띄운다.
  const rect = trigger.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = 'auto';
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 180) {
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    menu.style.transformOrigin = 'bottom right';
  } else {
    menu.style.top = `${rect.bottom + 4}px`;
  }
  openMenu(menu, trigger, { dynamic: true });
}

export function installMenus() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-menu-trigger]');
    if (trigger) {
      const menu = document.getElementById(trigger.dataset.menuTrigger);
      if (openMenuState?.menu === menu) closeMenu();
      else if (menu) openMenu(menu, trigger);
      return;
    }
    if (!openMenuState) return;
    // 동작 메뉴를 연 버튼의 클릭이 여기까지 올라와 바로 닫히지 않도록 한다.
    if (openMenuState.trigger?.contains(event.target)) return;
    if (event.target.closest('.menu-item') || !event.target.closest('.menu')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (!openMenuState) return;
    const { menu } = openMenuState;
    const items = [...menu.querySelectorAll('.menu-item:not([disabled])')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMenuItem(menu, index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(menu, index - 1);
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  });

  window.addEventListener('resize', () => closeMenu());
  // 화면에 고정된 동작 메뉴는 페이지가 실제로 스크롤되면 닫는다.
  // (누르기 직전의 스크롤 이벤트가 늦게 도착해 막 연 메뉴가 닫히지 않도록 거리 기준을 둔다)
  window.addEventListener('scroll', () => {
    if (openMenuState?.dynamic && Math.abs(window.scrollY - openMenuState.scrollY) > 24) closeMenu();
  }, { passive: true });
}

/* ---------------- 내비게이션 드로어 (모바일·태블릿에서는 임시 패널) ---------------- */
export function installDrawer(drawer, scrim) {
  if (!drawer) return { close() {} };
  let lastFocus = null;

  const close = () => {
    if (!drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    scrim?.classList.remove('is-open');
    lastFocus?.focus?.();
  };
  const open = () => {
    lastFocus = document.activeElement;
    drawer.classList.add('is-open');
    scrim?.classList.add('is-open');
    drawer.querySelector('.nav-item.active, .nav-item')?.focus();
  };

  document.querySelectorAll('[data-drawer-open]').forEach((button) => button.addEventListener('click', open));
  document.querySelectorAll('[data-drawer-close]').forEach((button) => button.addEventListener('click', close));
  drawer.addEventListener('click', (event) => {
    if (event.target.closest('.nav-item') && isMobileLayout()) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && drawer.classList.contains('is-open')) {
      event.preventDefault();
      close();
    }
  });
  return { open, close };
}

/* ---------------- 바텀시트 (모바일 입력 폼) ---------------- */
export function createSheet(panel, scrim, { onOpen } = {}) {
  if (!panel) return { open() {}, close() {}, isOpen: () => false };

  const isOpen = () => panel.classList.contains('is-open');
  const open = () => {
    if (!isMobileLayout()) {
      onOpen?.();
      return;
    }
    panel.classList.add('is-open');
    scrim?.classList.add('is-open');
    document.body.classList.add('is-sheet-open');
    onOpen?.();
  };
  const close = () => {
    panel.classList.remove('is-open');
    scrim?.classList.remove('is-open');
    document.body.classList.remove('is-sheet-open');
  };

  document.querySelectorAll('[data-sheet-open]').forEach((button) => button.addEventListener('click', open));
  document.querySelectorAll('[data-sheet-close]').forEach((button) => button.addEventListener('click', close));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && isOpen() && !isDialogOpen()) {
      event.preventDefault();
      close();
    }
  });
  // 화면이 넓어지면 시트 상태를 풀어 데스크톱 배치로 돌아간다.
  window.matchMedia?.(MOBILE_QUERY).addEventListener?.('change', (event) => {
    if (!event.matches) close();
  });
  return { open, close, isOpen };
}

/* ---------------- 미끄러지는 선택 표시 (사이드바 · 하단 탭 바) ---------------- */
// [data-indicator-group] 안의 .nav-indicator 를 현재 선택된(.active) 항목 위치로 옮긴다.
export function installNavIndicators(root = document) {
  const groups = [...root.querySelectorAll('[data-indicator-group]')];

  const update = ({ animate = true } = {}) => {
    groups.forEach((group) => {
      const indicator = group.querySelector('.nav-indicator');
      if (!indicator) return;
      group.classList.add('has-indicator');
      if (!animate) group.classList.add('no-anim');
      const active = group.querySelector(':scope > .active');
      if (!active || active.offsetParent === null) {
        indicator.style.opacity = '0';
      } else {
        indicator.style.opacity = '1';
        indicator.style.width = `${active.offsetWidth}px`;
        indicator.style.height = `${active.offsetHeight}px`;
        indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      }
      if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => group.classList.remove('no-anim')));
    });
  };

  update({ animate: false });
  // 화면 크기·글자 크기가 바뀌거나 글꼴이 늦게 로드돼도 위치를 다시 맞춘다.
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => update({ animate: false }));
    groups.forEach((group) => observer.observe(group));
  }
  document.fonts?.ready.then(() => update({ animate: false }));
  return { update };
}

/* ---------------- 화면 전환 효과 ---------------- */
// 메뉴를 바꾸면 새 화면이 진행 방향에서 살짝 떠오르며 나타난다. (Material "fade through")
// 화면 전체를 캡처하는 View Transitions API 는 하단 메뉴바·상단 바 같은 고정 요소를 가리고
// 선택 표시가 미끄러지는 움직임도 감추므로 쓰지 않고, 실제 요소에 CSS 애니메이션만 준다.
export function runViewTransition(update, { direction = 'forward', targets = [] } = {}) {
  document.documentElement.dataset.navDirection = direction;
  update();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  targets.filter(Boolean).forEach((element) => {
    element.classList.remove('view-enter');
    void element.offsetWidth; // 연달아 눌러도 애니메이션을 처음부터 다시 재생한다.
    element.classList.add('view-enter');
    const onEnd = (event) => {
      // 안쪽 요소(탭 패널 등)의 animationend 는 무시한다.
      if (event.target !== element) return;
      element.classList.remove('view-enter');
      element.removeEventListener('animationend', onEnd);
    };
    element.addEventListener('animationend', onEnd);
  });
}

/* ---------------- 탭 ---------------- */
export function installTabs(tablist, panelRoot, { onChange } = {}) {
  const tabs = () => [...tablist.querySelectorAll('[role="tab"][data-tab]:not(.hidden-view)')];

  const select = (name, { focus = false } = {}) => {
    tablist.querySelectorAll('[role="tab"][data-tab]').forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panelRoot.querySelectorAll('[data-tab-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== name;
    });
    onChange?.(name);
  };

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"][data-tab]');
    if (tab) select(tab.dataset.tab);
  });
  tablist.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const list = tabs();
    const current = list.findIndex((tab) => tab.classList.contains('active'));
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % list.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + list.length) % list.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = list.length - 1;
    event.preventDefault();
    select(list[next].dataset.tab, { focus: true });
  });
  return { select };
}
