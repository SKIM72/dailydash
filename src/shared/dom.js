export function appendCell(row, text, styleText = '') {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (styleText) cell.style.cssText = styleText;
  row.appendChild(cell);
  return cell;
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
