/* Library (outfits / backgrounds / props), Brands and Trends — the raw material the Create screen draws from. */
(function (CS) {
  const esc = CS.esc;

  /* ---------- library ---------- */
  let tab = 'wardrobe';
  const TABS = {
    wardrobe: { label: 'Outfits', one: 'outfit', kind: 'clothing outfit' },
    backgrounds: { label: 'Backgrounds', one: 'background', kind: 'background/environment' },
    accessories: { label: 'Props & accessories', one: 'accessory', kind: 'accessory prop' }
  };
  const brandOpts = () => '<option value="">None</option>' + CS.S.brands.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');

  CS.views.library = {
    render() {
      const cfg = TABS[tab], items = CS.S[tab];
      const seg = Object.keys(TABS).map(k => `<button class="${tab === k ? 'active' : ''}" data-action="libTab" data-v="${k}">${TABS[k].label} ${CS.S[k].length}</button>`).join('');
      const cards = items.map(it => `
        <div class="item">
          <h4>${esc(it.name)} ${it.confirmed ? '<span class="tag done">saved</span>' : '<span class="tag draft">draft</span>'}</h4>
          <div class="muted">${esc(it.desc || '')}</div>
          ${it.img ? `<div class="imgrow"><img class="imgprev" src="${it.img}" alt=""></div>` : ''}
          ${it.brandId && CS.find.brand(it.brandId) ? `<span class="tag">${esc(CS.find.brand(it.brandId).name)}</span>` : ''}
          <div class="row" style="margin-top:8px;">
            <button class="btn small secondary" data-action="libPrompt" data-id="${it.id}">Prompt</button>
            ${it.confirmed ? '' : `<button class="btn small green" data-action="libConfirm" data-id="${it.id}">Mark saved</button>`}
            <button class="btn small danger" data-action="libDelete" data-id="${it.id}">Delete</button>
          </div>
        </div>`).join('');
      return `
        <div class="page-head"><div><h1>Library</h1><p class="muted">Outfits, backgrounds and props. Assign them to creators, or pick them per video in Create.</p></div></div>
        <div class="seg" style="margin-bottom:14px;">${seg}</div>
        <div class="card"><h2>New ${cfg.one}</h2>
          <div class="grid2">
            <div class="field"><label>Name</label><input type="text" id="lib_name"></div>
            <div class="field" style="grid-column:span 2;"><label>Description</label><input type="text" id="lib_desc" placeholder="details, colors, materials…"></div>
            ${tab === 'accessories' ? `<div class="field"><label>Brand (optional)</label><select id="lib_brand">${brandOpts()}</select></div>` : ''}
          </div>
          <div class="field"><label>Reference photo (optional)</label><input type="file" accept="image/*" id="lib_img"></div>
          <button class="btn" data-action="libAdd">Add ${cfg.one}</button>
        </div>
        ${items.length ? `<div class="grid">${cards}</div>` : '<div class="empty">Nothing here yet.</div>'}`;
    }
  };
  CS.actions.libTab = d => { tab = d.v; CS.render(); };
  CS.actions.libAdd = async () => {
    const name = document.getElementById('lib_name').value.trim();
    if (!name) { CS.ui.toast('Name it first.'); return; }
    const f = document.getElementById('lib_img').files[0];
    const img = f ? await CS.readImage(f, 640) : null;
    const brandEl = document.getElementById('lib_brand');
    CS.S[tab].push({ id: CS.nid(tab[0]), name, desc: document.getElementById('lib_desc').value.trim(), brandId: brandEl ? brandEl.value : '', img, confirmed: false });
    CS.save(); CS.ui.toast('Added as draft.');
  };
  CS.actions.libConfirm = d => { const it = CS.S[tab].find(x => x.id === d.id); if (it) { it.confirmed = true; CS.save(); } };
  CS.actions.libDelete = d => CS.ui.confirm('Delete this item? Creators using it will lose the default.', () => {
    CS.S[tab] = CS.S[tab].filter(x => x.id !== d.id);
    CS.S.creators.forEach(c => { c.wardrobeIds = c.wardrobeIds.filter(i => i !== d.id); c.backgroundIds = c.backgroundIds.filter(i => i !== d.id); });
    CS.save();
  });
  CS.actions.libPrompt = d => {
    const it = CS.S[tab].find(x => x.id === d.id); if (!it) return;
    const brand = it.brandId ? CS.find.brand(it.brandId) : null;
    const prompt = `Generate a ${TABS[tab].kind} asset named "${it.name}".
Description: ${it.desc || '(see reference photo)'}
${it.img ? 'Reference photo attached — match its style/fit closely, adapt for realism.' : 'No reference photo — use the description only.'}
${brand ? `Brand promo: ${brand.name} — ${brand.notes || ''}\n` : ''}Once generated, save this as a reusable asset named "${it.name}" in the ${tab} library so it can be applied to any locked creator without regenerating it.`;
    CS.ui.modal({ title: it.name, body: `<pre class="prompt">${esc(prompt)}</pre>`, footer: `<button class="btn" data-action="copyPromptText" data-text="${esc(prompt)}">Copy prompt</button>` });
  };
  CS.actions.copyPromptText = d => CS.copy(d.text);

  /* ---------- brands ---------- */
  CS.views.brands = {
    render() {
      const list = CS.S.brands;
      return `
        <div class="page-head"><div><h1>Brands</h1><p class="muted">Sponsors and clients. Attach one to any video and its promo is written into the prompt.</p></div></div>
        <div class="card"><h2>New brand</h2>
          <div class="grid2"><div class="field"><label>Brand name</label><input type="text" id="brand_name"></div>
          <div class="field" style="grid-column:span 2;"><label>Notes (products, deal terms, links)</label><input type="text" id="brand_notes"></div></div>
          <button class="btn" data-action="brandAdd">Add brand</button></div>
        ${list.length ? `<div class="card"><table><tr><th>Brand</th><th>Notes</th><th></th></tr>${list.map(b => `<tr><td>${esc(b.name)}</td><td>${esc(b.notes || '')}</td><td><button class="btn small danger" data-action="brandDelete" data-id="${b.id}">Delete</button></td></tr>`).join('')}</table></div>` : '<div class="empty">No brands yet.</div>'}`;
    }
  };
  CS.actions.brandAdd = () => {
    const name = document.getElementById('brand_name').value.trim();
    if (!name) { CS.ui.toast('Brand name required.'); return; }
    CS.S.brands.push({ id: CS.nid('b'), name, notes: document.getElementById('brand_notes').value.trim() });
    CS.save();
  };
  CS.actions.brandDelete = d => CS.ui.confirm('Delete this brand?', () => { CS.S.brands = CS.S.brands.filter(b => b.id !== d.id); CS.save(); });

  /* ---------- trends ---------- */
  CS.views.trends = {
    render() {
      const list = CS.S.trends;
      return `
        <div class="page-head"><div><h1>Trends</h1><p class="muted">No platform gives a static page live trend data. Ask Claude in chat what’s trending, then log the useful ones here — they show up as quick picks in Create.</p></div></div>
        <div class="card"><h2>Log a trend</h2>
          <div class="grid2">
            <div class="field"><label>Platform</label><select id="tr_platform">${CS.OPTIONS.platforms.map(p => `<option>${p}</option>`).join('')}</select></div>
            <div class="field"><label>Trend / sound / format</label><input type="text" id="tr_topic"></div>
            <div class="field"><label>Note / link</label><input type="text" id="tr_note"></div>
          </div>
          <button class="btn" data-action="trendAdd">Log trend</button></div>
        ${list.length ? `<div class="card"><table><tr><th>Date</th><th>Platform</th><th>Trend</th><th>Note</th><th></th></tr>${list.map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.platform)}</td><td>${esc(t.topic)}</td><td>${esc(t.note)}</td><td><button class="btn small danger" data-action="trendDelete" data-id="${t.id}">Del</button></td></tr>`).join('')}</table></div>` : '<div class="empty">No trends logged yet.</div>'}`;
    }
  };
  CS.actions.trendAdd = () => {
    const topic = document.getElementById('tr_topic').value.trim();
    if (!topic) { CS.ui.toast('Describe the trend.'); return; }
    CS.S.trends.unshift({ id: CS.nid('t'), platform: document.getElementById('tr_platform').value, topic, note: document.getElementById('tr_note').value.trim(), date: CS.today() });
    CS.save();
  };
  CS.actions.trendDelete = d => { CS.S.trends = CS.S.trends.filter(t => t.id !== d.id); CS.save(); };
})(window.CS);
