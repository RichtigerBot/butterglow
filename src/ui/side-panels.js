// Panels on the right edge (editor, reference, preset browser) stand side by side, from right to left in the
// given order. If not everything fits into the window, the others close, first those with the highest
// priority in `closeOrder`. The panel that was just opened always stays open.
const MARGIN = 24;
const GAP = 12;

// `panels`: [{ element, isOpen(), close() }] from right to left. `closeOrder`: the same, in the order for closing.
export function createSidePanels({ panels, closeOrder = [...panels].reverse() }) {
  const placed = new Set();
  let busy = false;

  const openPanels = () => panels.filter((panel) => panel.isOpen());
  const needed = () => openPanels().reduce((sum, panel) => sum + panel.element.offsetWidth + GAP, 2 * MARGIN - GAP);

  function layout() {
    if (busy) return;
    busy = true;
    try {
      const fresh = openPanels().filter((panel) => !placed.has(panel));
      while (needed() > window.innerWidth) {
        const victim = closeOrder.find((panel) => panel.isOpen() && !fresh.includes(panel));
        if (!victim) break;
        victim.close();
      }
      let right = MARGIN;
      for (const panel of panels) {
        if (!panel.isOpen()) {
          placed.delete(panel);
          continue;
        }
        const { style } = panel.element;
        // A newly opened panel appears at its place right away. Only panels that are already visible slide aside.
        if (!placed.has(panel)) style.transition = 'none';
        style.right = `${right}px`;
        if (!placed.has(panel)) {
          void panel.element.offsetWidth;
          style.transition = '';
          placed.add(panel);
        }
        right += panel.element.offsetWidth + GAP;
      }
    } finally {
      busy = false;
    }
  }

  window.addEventListener('resize', layout);
  return { layout };
}
