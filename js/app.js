/* Boot: global event delegation (data-action / data-bind), routing, service worker. */
(function (CS) {
  // Any element with data-action="name" calls CS.actions.name(dataset, element, event).
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = CS.actions[el.dataset.action];
    if (fn) fn(el.dataset, el, e);
  });

  // Any form control with data-bind="scope.field" calls CS.binds.scope(field, element, eventType).
  const TEXTY = /^(text|url|number|search|date|email)$/;
  function dispatch(el, type) {
    const parts = el.dataset.bind.split('.'), h = CS.binds[parts[0]];
    if (h) h(parts.slice(1).join('.'), el, type);
  }
  document.addEventListener('input', e => {
    const el = e.target.closest('[data-bind]');
    if (el && (el.tagName === 'TEXTAREA' || TEXTY.test(el.type))) dispatch(el, 'input');
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-bind]');
    if (el) dispatch(el, 'change');
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') CS.ui.closeModal(); });
  window.addEventListener('hashchange', () => { CS.ui.closeModal(); CS.render(); window.scrollTo(0, 0); });

  CS.render();
  // the media library loads asynchronously; re-render once it's ready so Files / Queue can show it
  CS.media.init().then(() => CS.render());

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})(window.CS);
