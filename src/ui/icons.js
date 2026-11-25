// Small line-art icons for the visconf editor's media controls, drawn for ButterGlow instead of the font's ▶ ⏸ ● ■
// characters, which look different on every system. All are 24 × 24 and use the text colour (currentColor), except
// the red dot of the record button.

const svg = (body) => `<svg class="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  record: svg('<circle cx="12" cy="12" r="6.5" fill="#ff4d61"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/>'),
  play: svg('<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" fill="currentColor"/>'),
  pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="currentColor"/>'),
  toStart: svg('<rect x="5" y="5" width="2.6" height="14" rx="1.2" fill="currentColor"/><path d="M10 12.86l8.5 5.4a1 1 0 0 0 1.5-.84V6.58a1 1 0 0 0-1.5-.84L10 11.14a1 1 0 0 0 0 1.72z" fill="currentColor"/>'),
  repeat: svg('<path d="M5 11V9.5A3.5 3.5 0 0 1 8.5 6H18M15 3l3 3-3 3M19 13v1.5a3.5 3.5 0 0 1-3.5 3.5H6m3 3-3-3 3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  // An arrow running into a wall: play to the end, then stand still.
  stopAtEnd: svg('<path d="M3.5 12h10.5M10.5 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="17" y="5" width="3" height="14" rx="1.3" fill="currentColor"/>'),
};

// Puts an icon and, if given, a text into a button. The text stays readable for screen readers either way.
export function setIcon(button, name, text = '') {
  const key = `${name}|${text}`;
  if (button.dataset.icon === key) return;
  button.dataset.icon = key;
  button.innerHTML = ICONS[name];
  if (text) {
    const label = document.createElement('span');
    label.textContent = text;
    button.append(label);
  }
}
