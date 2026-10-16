import { icon, notify, pageURL } from './helpers.js';
const modes = [
  { type: 'toilet', label: 'Toilets', icon: 'wc' },
  { type: 'water', label: 'Water', icon: 'water' },
  { type: 'store', label: 'Stores', icon: 'store' },
];
export function quickType() {
  try {
    const saved = localStorage.getItem('parkpal.quickType');
    return modes.some((m) => m.type === saved) ? saved : 'toilet';
  } catch {
    return 'toilet';
  }
}
const button = document.querySelector('.toilet-shortcut');
let type = quickType(),
  timer,
  held = false,
  cancelled = false,
  pointer = null,
  start;
function render() {
  if (!button) return;
  const mode = modes.find((m) => m.type === type);
  button.dataset.type = type;
  button.setAttribute(
    'aria-label',
    `Find closest ${mode.label.toLowerCase()}. Hold for 5 seconds to change facility type.`,
  );
  button.title = 'Hold for 5 seconds to change facility type';
  button.innerHTML = `<span class="toilet-circle">${icon(mode.icon)}</span><span>${mode.label}</span>`;
  if (button.tagName === 'A') button.href = pageURL(`index.html?quick=${type}`);
}
function cancel() {
  clearTimeout(timer);
  button?.classList.remove('quick-holding');
  pointer = null;
}
function hold() {
  held = false;
  cancelled = false;
  button.classList.remove('quick-changed');
  button.classList.add('quick-holding');
  timer = setTimeout(() => {
    held = true;
    type = modes[(modes.findIndex((m) => m.type === type) + 1) % modes.length].type;
    try {
      localStorage.setItem('parkpal.quickType', type);
    } catch {
      /* Current page still works without storage. */
    }
    render();
    button.classList.remove('quick-holding');
    button.classList.remove('quick-changed');
    void button.offsetWidth;
    button.classList.add('quick-changed');
    notify(
      `Quick search: ${modes.find((m) => m.type === type).label}. Tap to find nearby facilities.`,
    );
  }, 5000);
}
if (button) {
  render();
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || button.disabled) return;
    pointer = event.pointerId;
    start = { x: event.clientX, y: event.clientY };
    button.setPointerCapture?.(pointer);
    hold();
  });
  button.addEventListener('pointermove', (event) => {
    if (
      pointer !== null &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 15
    ) {
      cancelled = true;
      cancel();
    }
  });
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointercancel', () => {
    cancelled = true;
    cancel();
  });
  button.addEventListener('lostpointercapture', cancel);
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) hold();
    }
  });
  button.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      cancel();
      button.click();
    }
  });
  button.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel();
  });
  button.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
      if (held || cancelled) {
        held = false;
        cancelled = false;
        return;
      }
      if (button.id === 'nearest-toilet')
        button.dispatchEvent(new CustomEvent('quick-search', { detail: type }));
      else location.href = pageURL(`index.html?quick=${type}`);
    },
    true,
  );
}
