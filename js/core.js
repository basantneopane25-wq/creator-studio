/* Core: namespace, helpers, state store, UI primitives (toast / modal), router.
   Everything hangs off window.CS so the app works when opened from a file or any static host — no build step. */
window.CS = { S: null, actions: {}, binds: {}, views: {}, ui: {} };

(function (CS) {
  /* ---------- helpers ---------- */
  const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  CS.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => MAP[c]);
  CS.today = () => new Date().toISOString().slice(0, 10);
  CS.now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  CS.truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  CS.clone = o => JSON.parse(JSON.stringify(o));

  // Downscale uploaded reference photos so localStorage (~5MB) doesn't fill up after a few uploads.
  CS.readImage = (file, max) => new Promise(resolve => {
    max = max || 640;
    const r = new FileReader();
    r.onerror = () => resolve(null);
    r.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(r.result);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });

  CS.copy = (text, quiet) => {
    const done = () => { if (!quiet) CS.ui.toast('Copied to clipboard.'); };
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = text; t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { CS.ui.toast('Copy failed — select the text manually.'); }
      t.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };

  /* ---------- state store ---------- */
  const KEY = 'creatorStudioData';
  const VERSION = 2;

  function defaults() {
    return {
      v: VERSION, seq: 1, lastFormat: 'ugc',
      creators: [], wardrobe: [], backgrounds: [], accessories: [], brands: [], trends: [], jobs: [],
      drafts: {},
      settings: { plan: 'Not subscribed yet', allowance: 1000, budget: 50, creditLog: [], imagegen: { provider: 'free', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: '' },
        higgs: { mode: 'off', keyId: '', keySecret: '', proxyUrl: '', proxyToken: '', ack: false, caps: { perJob: 3, daily: 10, monthly: 50 }, autoBelowUsd: 0.1, maxParallel: 3, disclose: true } }
    };
  }

  // Accepts data from any earlier version (v1 had no drafts / titles / job.draft) and fills the gaps.
  function normalize(raw) {
    const s = Object.assign(defaults(), raw && typeof raw === 'object' ? raw : {});
    s.settings = Object.assign(defaults().settings, s.settings || {});
    s.settings.imagegen = Object.assign(defaults().settings.imagegen, s.settings.imagegen || {});
    const hd = defaults().settings.higgs; s.settings.higgs = Object.assign(hd, s.settings.higgs || {}); s.settings.higgs.caps = Object.assign({ perJob: 3, daily: 10, monthly: 50 }, (s.settings.higgs || {}).caps || {});
    ['creators', 'wardrobe', 'backgrounds', 'accessories', 'brands', 'trends', 'jobs'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    if (!Array.isArray(s.settings.creditLog)) s.settings.creditLog = [];
    if (!s.drafts || typeof s.drafts !== 'object') s.drafts = {};
    s.creators.forEach(c => { c.wardrobeIds = c.wardrobeIds || []; c.backgroundIds = c.backgroundIds || []; c.faceRefs = c.faceRefs || []; c.soulId = typeof c.soulId === 'string' ? c.soulId : ''; c.soulTrained = !!c.soulTrained; });
    s.v = VERSION;
    // v1 credit-log entries weren't tied to their job; link them so editing a job's credits can't double-count
    s.jobs.forEach(j => {
      if (j.status !== 'done') return;
      const want = 'Job: ' + j.type + (j.note ? ' — ' + j.note : '');
      const hit = s.settings.creditLog.find(l => !l.jobId && l.note === want && +l.amount === +j.credits);
      if (hit) hit.jobId = j.id;
    });
    // keep the id counter ahead of every existing id so new records never collide
    let max = s.seq || 1;
    [].concat(s.creators, s.wardrobe, s.backgrounds, s.accessories, s.brands, s.trends, s.jobs).forEach(o => {
      const n = parseInt(String(o.id || '').replace(/\D/g, ''), 10);
      if (n >= max) max = n + 1;
    });
    s.seq = max;
    return s;
  }

  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { console.error(e); return normalize(null); }
  }

  CS.S = load();
  CS.blankState = () => normalize(null);
  CS.normalize = normalize;
  CS.nid = p => p + (CS.S.seq++);

  // persist() = save quietly (used while typing); save() = save + re-render the current view.
  CS.persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(CS.S)); return true; }
    catch (e) { CS.ui.toast('Storage full — export a backup and remove some reference images.'); return false; }
  };
  CS.save = () => { CS.persist(); CS.render(); };

  CS.find = {
    creator: id => CS.S.creators.find(c => c.id === id) || null,
    brand: id => CS.S.brands.find(b => b.id === id) || null,
    job: id => CS.S.jobs.find(j => j.id === id) || null
  };
  CS.creditsUsed = () => {
    const ym = new Date().toISOString().slice(0, 7);
    return CS.S.settings.creditLog.filter(l => String(l.date).startsWith(ym)).reduce((a, l) => a + (+l.amount || 0), 0);
  };

  /* ---------- toast ---------- */
  let toastTimer, toastFn;
  CS.ui.toast = (msg, opt) => {
    const t = document.getElementById('toast');
    t.innerHTML = `<span>${CS.esc(msg)}</span>` + (opt && opt.label ? `<button class="toast-btn" data-action="toastAction">${CS.esc(opt.label)}</button>` : '');
    toastFn = opt && opt.fn;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), opt && opt.label ? 5500 : 2600);
  };
  CS.actions.toastAction = () => { if (toastFn) toastFn(); document.getElementById('toast').classList.remove('show'); };

  /* ---------- modal ---------- */
  CS.ui.modal = o => {
    document.getElementById('modalRoot').innerHTML =
      `<div class="modal-bg" data-action="modalBackdrop"><div class="modal ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${CS.esc(o.title)}">
        <div class="modal-head"><h2>${CS.esc(o.title)}</h2><button class="icon-btn" data-action="closeModal" aria-label="Close">✕</button></div>
        <div class="modal-body">${o.body}</div>
        ${o.footer ? `<div class="modal-foot">${o.footer}</div>` : ''}
      </div></div>`;
    document.body.classList.add('modal-open');
  };
  CS.ui.closeModal = () => { document.getElementById('modalRoot').innerHTML = ''; document.body.classList.remove('modal-open'); };
  CS.actions.closeModal = CS.ui.closeModal;
  CS.actions.modalBackdrop = (d, el, e) => { if (e.target === el) CS.ui.closeModal(); };

  let confirmFn;
  CS.ui.confirm = (message, onYes, opt) => {
    opt = opt || {}; confirmFn = onYes;
    CS.ui.modal({
      title: opt.title || 'Are you sure?',
      body: `<p style="margin:0">${CS.esc(message)}</p>`,
      footer: `<button class="btn secondary" data-action="closeModal">Cancel</button><button class="btn ${opt.danger === false ? '' : 'danger'}" data-action="confirmYes">${CS.esc(opt.yes || 'Delete')}</button>`
    });
  };
  CS.actions.confirmYes = () => { const f = confirmFn; confirmFn = null; CS.ui.closeModal(); if (f) f(); };

  /* ---------- router (hash based: #/create/story, #/queue …) ---------- */
  CS.routes = [
    { id: 'home', label: 'Home', icon: '🏠' },
    { id: 'create', label: 'Create', icon: '✨', cta: true },
    { id: 'queue', label: 'Queue', icon: '📋' },
    { id: 'creators', label: 'Creators', icon: '🧑‍🎤' },
    { id: 'files', label: 'Files', icon: '📁' },
    { id: 'library', label: 'Library', icon: '👗' },
    { id: 'brands', label: 'Brands', icon: '🏷️' },
    { id: 'trends', label: 'Trends', icon: '🔥' },
    { id: 'playbook', label: 'Playbook', icon: '📘' },
    { id: 'settings', label: 'Settings', icon: '⚙️' }
  ];

  CS.route = () => {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const id = CS.views[parts[0]] ? parts[0] : 'home';
    return { id, params: parts.slice(1) };
  };

  CS.go = path => {
    const target = '#/' + path;
    if (location.hash === target) CS.render(); else location.hash = target;
  };

  CS.render = () => {
    const r = CS.route(), on = r.id === 'produce' ? 'queue' : r.id; // a production belongs under Queue in the menu
    const v = CS.views[r.id];
    document.getElementById('app').innerHTML = v.render(r.params);
    document.getElementById('nav').innerHTML = CS.routes.map(x => `<a href="#/${x.id}" class="${x.id === on ? 'active' : ''}">${x.label}</a>`).join('');
    document.getElementById('navBottom').innerHTML = CS.routes

      .map(x => `<a href="#/${x.id}" class="${x.id === on ? 'active' : ''} ${x.cta ? 'main-cta' : ''}"><span class="ic">${x.icon}</span>${x.label}</a>`).join('');
    const route = CS.routes.find(x => x.id === r.id); // screens like "produce" aren't in the menu
    document.title = (r.id === 'home' ? '' : (route ? route.label : r.id.charAt(0).toUpperCase() + r.id.slice(1)) + ' · ') + 'Creator Studio';
    const used = CS.creditsUsed(), allow = CS.S.settings.allowance || 0;
    const hg = CS.S.settings.higgs;
    document.getElementById('creditPill').textContent = hg && hg.mode !== 'off' && CS.produce ? '$' + CS.produce.budget.spentSince(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()).toFixed(2) + ' this month' : (allow ? `credits ${used}/${allow}` : `credits used ${used}`);
    if (v.after) v.after(r.params);
  };
})(window.CS);
