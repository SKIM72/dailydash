// 이 기기에서만 적용되는 화면 설정 (글자 크기, 저장 전 확인창)

const TEXT_SCALE_KEY = 'dailydash-text-scale';
const CONFIRM_KEY = 'dailydash-confirm-before-save';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 적용된다.
  }
}

export function getTextScale() {
  const value = Number(read(TEXT_SCALE_KEY));
  return value >= 0.9 && value <= 1.3 ? value : 1;
}

export function applyTextScale(scale) {
  document.documentElement.style.setProperty('--text-scale', String(scale));
}

function paintSlider(slider, output) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const value = Number(slider.value);
  slider.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
  if (output) output.textContent = `${value}%`;
}

export function installTextScaleSlider(slider, output) {
  if (!slider) return;
  slider.value = String(Math.round(getTextScale() * 100));
  paintSlider(slider, output);
  slider.addEventListener('input', () => {
    paintSlider(slider, output);
    applyTextScale(Number(slider.value) / 100);
  });
  slider.addEventListener('change', () => write(TEXT_SCALE_KEY, String(Number(slider.value) / 100)));
}

export function isConfirmBeforeSave() {
  return read(CONFIRM_KEY) !== 'off';
}

export function installConfirmSwitch(input) {
  if (!input) return;
  input.checked = isConfirmBeforeSave();
  input.addEventListener('change', () => write(CONFIRM_KEY, input.checked ? 'on' : 'off'));
}
