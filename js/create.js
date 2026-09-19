/* Create studio — the main workspace: pick a format, cast a creator, set look + sound, get a ready prompt. */
(function (CS) {
  const esc = CS.esc;
  let cur = 'ugc';

  function draft(fid) {
    const D = CS.S.drafts, f = CS.FORMATS[fid];
    if (!D[fid]) D[fid] = CS.blankDraft(fid);
    const d = Object.assign(CS.blankDraft(fid), D[fid]);
    d.audioMode = f.audio.length ? (f.audio.indexOf(d.audioMode) < 0 ? f.audio[0] : d.audioMode) : '';
    D[fid] = d;
    return d;
  }

  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;

  function avatar(c, lg) {
    const cls = 'avatar' + (lg ? ' lg' : '');
    if (c && c.faceRefs && c.faceRefs[0]) return `<img class="${cls}" src="${c.faceRefs[0]}" alt="">`;
    return `<span class="${cls}">${c ? esc((c.name || '?')[0].toUpperCase()) : '∅'}</span>`;
  }
  CS.avatar = avatar;

  function chip(type, bind, value, label, checked, name) {
    return `<label class="chip"><input type="${type}" name="${name || bind}" data-bind="create.${bind}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  }

  /* ---------- sections ---------- */
  function secConcept(f, d) {
    let h = '';
    if (f.url) h += field('Video link (TikTok / Insta / Shorts)', `<input type="url" data-bind="create.url" value="${esc(d.url)}" placeholder="https://…">`);
    if (f.concept) {
      h += field(esc(f.concept.label) + (f.concept.required ? '' : ' <span class="muted">(optional)</span>'),
        `<textarea data-bind="create.concept" placeholder="${esc(f.concept.placeholder)}">${esc(d.concept)}</textarea>`);
      const trends = CS.S.trends;
      h += `<div class="row" style="margin:-4px 0 12px;">
        ${f.ideas.length ? '<button type="button" class="btn small secondary" data-action="inspire">🎲 Inspire me</button>' : ''}
        ${trends.length ? `<select data-bind="create.trendPick" style="width:auto;max-width:100%;"><option value="">Start from a logged trend…</option>${trends.map(t => `<option value="${t.id}">${esc(t.platform)}: ${esc(CS.truncate(t.topic, 50))}</option>`).join('')}</select>` : ''}
      </div>`;
    }
    if (f.product) h += field('Product / offer', `<input type="text" data-bind="create.product" value="${esc(d.product)}" placeholder="e.g. Grip Mount phone holder — 2 for $19">`);
    if (f.cta) h += field('Call to action', `<input type="text" data-bind="create.cta" value="${esc(d.cta)}" placeholder="e.g. Use code SAVE10 — link in bio">`);
    return h;
  }

  function secCreator(f, d) {
    const list = CS.S.creators;
    if (!list.length) return `<div class="empty">You haven’t made a creator yet.<br><a class="btn small" href="#/creators">Create your first creator</a></div>`;
    const card = (id, title, sub, c) => `<label class="pick"><input type="radio" name="creator" data-bind="create.creatorId" value="${esc(id)}" ${d.creatorId === id ? 'checked' : ''}><span class="pick-body">${avatar(c)}<span><b>${esc(title)}</b><small>${esc(sub)}</small></span></span></label>`;
    const cards = (f.creator === 'optional' ? [card('', 'No fixed creator', 'Let the concept decide', null)] : [])
      .concat(list.map(c => card(c.id, c.name, (c.profession || c.gender) + (c.locked ? ' · 🔒 locked' : ' · draft'), c)));
    return `<div class="pick-grid">${cards.join('')}</div>`;
  }

  function secLook(d) {
    const S = CS.S, cr = CS.find.creator(d.creatorId);
    const aw = cr ? cr.wardrobeIds : [], ab = cr ? cr.backgroundIds : [];
    if (!S.wardrobe.length && !S.backgrounds.length && !S.accessories.length)
      return `<div class="empty">No outfits, backgrounds or props yet.<br><a class="btn small secondary" href="#/library">Add some in the Library</a></div>`;
    const star = (ids, id) => (ids.indexOf(id) >= 0 ? '★ ' : '');
    let h = '';
    if (S.wardrobe.length) h += field('Outfit <span class="muted">(pick any)</span>', `<div class="chips">${S.wardrobe.map(w => chip('checkbox', 'wardrobeIds', w.id, star(aw, w.id) + esc(w.name), d.wardrobeIds.indexOf(w.id) >= 0, 'wardrobe')).join('')}</div>`);
    if (S.backgrounds.length) h += field('Background', `<div class="chips">${chip('radio', 'backgroundId', '', 'None', !d.backgroundId, 'bg')}${S.backgrounds.map(b => chip('radio', 'backgroundId', b.id, star(ab, b.id) + esc(b.name), d.backgroundId === b.id, 'bg')).join('')}</div>`);
    if (S.accessories.length) h += field('Props / accessories', `<div class="chips">${S.accessories.map(a => chip('checkbox', 'accessoryIds', a.id, esc(a.name), d.accessoryIds.indexOf(a.id) >= 0, 'acc')).join('')}</div>`);
    if (cr) h += '<div class="muted">★ = assigned to this creator. Assign more from the creator’s profile.</div>';
    return h;
  }

  function secSound(f, d) {
    if (!f.audio.length) return '';
    let h = `<div class="chips" style="margin-bottom:12px;">${f.audio.map(m => `<label class="chip big"><input type="radio" name="audioMode" data-bind="create.audioMode" value="${m}" ${d.audioMode === m ? 'checked' : ''}><span><b>${CS.AUDIO_MODES[m].label}</b><small>${CS.AUDIO_MODES[m].hint}</small></span></label>`).join('')}</div>`;
    if (d.audioMode === 'trend') {
      h += field('Trending sound (name or link)', `<input type="text" data-bind="create.audioText" value="${esc(d.audioText)}" placeholder="e.g. sound name, or link to the original audio">`);
      if (CS.S.trends.length) h += `<select data-bind="create.audioTrendPick"><option value="">Pick from your trend log…</option>${CS.S.trends.map(t => `<option value="${t.id}">${esc(t.platform)}: ${esc(CS.truncate(t.topic, 50))}</option>`).join('')}</select>`;
    } else if (d.audioMode === 'upload') {
      h += field('Audio file', `<input type="file" accept="audio/*" data-bind="create.audioFile">`);
      h += `<div class="muted">${d.audioFile ? `✓ ${esc(d.audioFile.name)} (${esc(d.audioFile.duration)}) — attach this same file in the Claude chat.` : 'No file selected yet.'}</div>`;
    }
    return h;
  }

  function secDetails(f, d) {
    const sel = (bind, arr, cur, fmt) => `<select data-bind="create.${bind}">${arr.map(v => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(fmt ? fmt(v) : v)}</option>`).join('')}</select>`;
    const brands = `<select data-bind="create.brandId"><option value="">None</option>${CS.S.brands.map(b => `<option value="${b.id}" ${d.brandId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`;
    const shape = v => v + ({ '4:5': ' · feed portrait', '1:1': ' · square', '9:16': ' · story / reel', '16:9': ' · wide' }[v] || '');
    const grid = f.image
      ? `<div class="grid2">${field('Shape', sel('aspect', CS.OPTIONS.aspects, d.aspect, shape))}${field('How many', sel('count', CS.OPTIONS.counts, d.count))}${field('Brand promo', brands)}</div>`
      : `<div class="grid2">
          ${field('Platform', sel('platform', CS.OPTIONS.platforms, d.platform))}
          ${field('Length', sel('duration', CS.OPTIONS.durations, d.duration, v => v + ' sec'))}
          ${field('Opening hook', sel('hook', CS.OPTIONS.hooks, d.hook))}
          ${field('Brand promo', brands)}
        </div>`;
    return field(f.id === 'sing' ? 'Performance style' : 'Style', `<div class="chips">${f.styles.map(s => chip('radio', 'style', s, esc(s.replace(/^Recommended: /, '')) + (s.indexOf('Recommended') === 0 ? ' <small>★</small>' : ''), d.style === s, 'style')).join('')}</div>`)
      + grid
      + field(esc(f.notesLabel || 'Extra notes') + ' <span class="muted">(optional)</span>', `<textarea data-bind="create.notes" placeholder="Anything else Claude should know…">${esc(d.notes)}</textarea>`);
  }

  function side(f, d) {
    const chk = CS.checkDraft(cur, d), ready = !chk.missing.length;
    const prompt = CS.buildPrompt(cur, d);
    return `<div class="card">
      <div class="row between"><h2>Prompt preview</h2><span class="tag ${ready ? 'done' : 'draft'}">${ready ? 'Ready' : 'Needs ' + chk.missing.length + ' more'}</span></div>
      ${chk.missing.length ? `<ul class="checklist miss">${chk.missing.map(m => `<li>Add ${esc(m)}</li>`).join('')}</ul>` : ''}
      ${chk.warn.length ? `<ul class="checklist warn">${chk.warn.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      <pre class="prompt tall">${esc(prompt)}</pre>
      ${f.image ? `<details><summary class="muted" style="cursor:pointer;">Prompt used by “Generate here”</summary><pre class="prompt">${esc(f.imagePrompt(d, CS.buildContext(d)))}</pre></details>` : ''}
      <div class="row">
        ${f.image ? `<button class="btn" data-action="createGenerate" ${ready && !gen.busy ? '' : 'disabled'}>${gen.busy ? 'Generating…' : '✨ Generate here'}</button>` : ''}
        <button class="btn ${f.image ? 'secondary' : ''}" data-action="createSend" ${ready ? '' : 'disabled'}>${f.image ? 'Copy for Higgsfield &amp; queue' : 'Copy &amp; add to queue'}</button>
        <button class="btn secondary" data-action="createDraft" ${ready ? '' : 'disabled'}>Save as draft</button>
      </div>
      <div class="muted" style="margin-top:8px;">${f.image
        ? 'Generate here makes pictures right now. To keep the creator’s locked face (Soul ID), copy the prompt into your Claude chat with the Higgsfield connector on instead.'
        : 'Paste the copied prompt into your Claude chat with the Higgsfield connector on. Then mark the job done in the Queue and attach the finished file.'}</div>
      <button class="link-btn" data-action="createReset">Reset this form</button>
    </div>`;
  }

  CS.views.create = {
    render(params) {
      cur = CS.FORMATS[params[0]] ? params[0] : (CS.FORMATS[CS.S.lastFormat] ? CS.S.lastFormat : 'ugc');
      CS.S.lastFormat = cur;
      const f = CS.FORMATS[cur], d = draft(cur);
      const sections = [
        ['Concept', f.image ? 'What is in the photo?' : 'What is this video about?', secConcept(f, d)],
        ['Creator', f.creator === 'required' ? 'Who is on screen? (required)' : 'Who is on screen? (optional)', secCreator(f, d)],
        ['Look', 'Outfit, setting and props', secLook(d)],
        ['Sound', 'How should it sound?', secSound(f, d)],
        ['Style & details', 'Finishing touches', secDetails(f, d)]
      ].filter(s => s[2]);
      return `
        <div class="page-head"><div><h1>Create</h1><p class="muted">Pick a format, cast a creator, set the look and sound. The prompt builds itself as you go.</p></div></div>
        <div class="fmt-tiles">${Object.keys(CS.FORMATS).map(id => { const x = CS.FORMATS[id]; return `<a class="fmt-tile ${id === cur ? 'active' : ''}" href="#/create/${id}"><span class="fmt-icon">${x.icon}</span><b>${x.label}</b><small>${x.tagline}</small></a>`; }).join('')}</div>
        <div class="create-layout">
          <div class="create-form">${sections.map((s, i) => `<section class="step"><div class="step-head"><span class="step-num">${i + 1}</span><h2>${s[0]}</h2><span class="muted">${s[1]}</span></div>${s[2]}</section>`).join('')}</div>
          <aside class="create-side"><div id="createSide">${side(f, d)}</div><div id="genResults">${genHtml()}</div></aside>
        </div>`;
    }
  };

  /* ---------- in-app picture generation ---------- */
  // Kept in memory while you're on this page; pictures only become files once you tap Save.
  const gen = { busy: false, pending: 0, total: 0, items: [], errors: [] };
  let gid = 0;

  function genHtml() {
    if (!CS.FORMATS[cur].image || (!gen.busy && !gen.items.length && !gen.errors.length)) return '';
    const unsaved = gen.items.filter(i => !i.saved).length;
    const cr = gen.items[0] ? CS.find.creator(gen.items[0].creatorId) : null;
    return `<div class="card" id="genCard">
      <div class="row between"><h2>Results</h2><span class="muted">via ${esc(CS.imagegen.label())}</span></div>
      ${gen.busy ? `<div class="muted" style="margin:6px 0;">⏳ Making picture ${gen.total - gen.pending + 1} of ${gen.total}… this can take up to a minute each.</div>` : ''}
      ${gen.errors.map(e => `<div class="err-line">✕ ${esc(e)}</div>`).join('')}
      ${gen.items.length ? `<div class="gen-grid">${gen.items.map(i => `
        <figure class="gen-item"><img src="${i.url}" alt="Generated picture" data-action="genView" data-id="${i.id}">
          <div class="row">${i.saved ? `<span class="tag done">✓ saved${i.synced ? ' to phone' : ''}</span>` : `<button class="btn small" data-action="genSave" data-id="${i.id}">Save</button>`}
          <button class="btn small ghost" data-action="genDrop" data-id="${i.id}">✕</button></div></figure>`).join('')}</div>` : ''}
      ${unsaved > 1 ? `<div class="row" style="margin-top:8px;"><button class="btn secondary small" data-action="genSaveAll">Save all ${unsaved}</button><button class="link-btn" data-action="genDropAll">Discard all</button></div>` : ''}
      ${gen.items.length ? `<div class="muted" style="margin-top:8px;">Saved pictures go to <b>${esc(CS.media.ROOT)} / ${esc(cr ? CS.media.folderFor(cr.id) : '…')} / Pics</b> and appear in <a href="#/files">Files</a>.</div>` : ''}
      ${CS.imagegen.settings().provider === 'free' ? '<div class="muted" style="margin-top:6px;">The free service can’t keep the same face between pictures. For a consistent look use Higgsfield, or add your own provider in Settings.</div>' : ''}
    </div>`;
  }

  async function generate() {
    const f = CS.FORMATS[cur], d = draft(cur);
    if (gen.busy) return;
    if (CS.checkDraft(cur, d).missing.length) { CS.ui.toast('Fill in the missing items first.'); return; }
    if (!CS.imagegen.ready()) { CS.ui.toast('Add your image provider key in Settings first.', { label: 'Settings', fn: () => CS.go('settings') }); return; }
    const prompt = f.imagePrompt(d, CS.buildContext(d)), n = parseInt(d.count, 10) || 1, base = Math.floor(Math.random() * 1e6);
    Object.assign(gen, { busy: true, pending: n, total: n, errors: [] });
    renderGen();
    const card = document.getElementById('genCard'); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    for (let i = 0; i < n; i++) { // one at a time: kinder to the free service, and you see each picture as it lands
      try {
        const blob = await CS.imagegen.generate(prompt, d.aspect, base + i);
        gen.items.push({ id: 'g' + (++gid), blob, url: URL.createObjectURL(blob), saved: false, synced: false, creatorId: d.creatorId, prompt });
      } catch (e) { gen.errors.push(e.message || String(e)); if (/busy|key|Unauthorized|Incorrect/i.test(e.message || '')) { gen.pending = 0; break; } }
      gen.pending--; renderGen();
    }
    Object.assign(gen, { busy: false, pending: 0 });
    renderGen();
  }

  async function saveItem(i) {
    if (i.saved) return true;
    try {
      const rec = await CS.media.add({ blob: i.blob, kind: 'pic', creatorId: i.creatorId, source: 'generated', prompt: i.prompt });
      i.saved = rec.id; i.synced = rec.synced; return true;
    } catch (e) { CS.ui.toast('Couldn’t save: ' + (e.message || 'storage is full')); return false; }
  }
  const findGen = id => gen.items.find(x => x.id === id);
  const dropGen = i => { URL.revokeObjectURL(i.url); gen.items = gen.items.filter(x => x !== i); };
  const afterSave = () => {
    renderGen();
    CS.media.status().then(st => {
      if (st === 'ready') CS.ui.toast('Saved to your phone folder.');
      else CS.ui.toast('Saved in the app.', { label: 'Set up phone folder', fn: () => CS.go('files') });
    });
  };
  CS.actions.createGenerate = generate;
  CS.actions.genSave = async d => { const i = findGen(d.id); if (i && await saveItem(i)) afterSave(); };
  CS.actions.genSaveAll = async () => { for (const i of gen.items.filter(x => !x.saved)) await saveItem(i); afterSave(); };
  CS.actions.genDrop = d => { const i = findGen(d.id); if (i) { dropGen(i); renderGen(); } };
  CS.actions.genDropAll = () => { gen.items.filter(x => !x.saved).forEach(dropGen); renderGen(); };
  CS.actions.genView = d => { const i = findGen(d.id); if (i) CS.ui.modal({ title: 'Preview', wide: true, body: `<img src="${i.url}" alt="" style="width:100%;border-radius:8px;">`, footer: `<button class="btn secondary" data-action="closeModal">Close</button>` }); };

  /* ---------- interactions ---------- */
  function rerender() { const y = window.scrollY; CS.render(); window.scrollTo(0, y); }
  function updateSide() { const el = document.getElementById('createSide'); if (el) el.innerHTML = side(CS.FORMATS[cur], draft(cur)); }
  function renderGen() { const el = document.getElementById('genResults'); if (el) el.innerHTML = genHtml(); updateSide(); }
  let persistTimer;
  function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(CS.persist, 300); }

  function applyCreator(fid, id) {
    const d = draft(fid), cr = CS.find.creator(id);
    d.creatorId = id;
    d.wardrobeIds = cr ? cr.wardrobeIds.slice() : [];
    d.backgroundId = cr && cr.backgroundIds[0] ? cr.backgroundIds[0] : '';
  }

  CS.binds.create = (name, el) => {
    const d = draft(cur);
    if (name === 'wardrobeIds' || name === 'accessoryIds') {
      d[name] = Array.from(document.querySelectorAll(`input[data-bind="create.${name}"]:checked`)).map(i => i.value);
    } else if (name === 'trendPick' || name === 'audioTrendPick') {
      const t = CS.S.trends.find(x => x.id === el.value);
      if (!t) return;
      if (name === 'trendPick') d.concept = `${t.topic}${t.note ? ' — ' + t.note : ''} (${t.platform} trend)`;
      else d.audioText = t.topic + (t.note ? ' — ' + t.note : '');
      CS.persist(); rerender(); return;
    } else if (name === 'audioFile') {
      const file = el.files && el.files[0];
      if (!file) { d.audioFile = null; CS.persist(); rerender(); return; }
      const url = URL.createObjectURL(file), a = new Audio();
      const finish = dur => { d.audioFile = { name: file.name, duration: dur }; URL.revokeObjectURL(url); CS.persist(); rerender(); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => finish(isFinite(a.duration) ? Math.round(a.duration) + 's' : 'unknown length');
      a.onerror = () => finish('unknown length');
      a.src = url;
      return;
    } else if (name === 'creatorId') {
      applyCreator(cur, el.value); CS.persist(); rerender(); return;
    } else {
      d[name] = el.value;
      if (name === 'audioMode') { CS.persist(); rerender(); return; }
    }
    persistSoon(); updateSide();
  };

  CS.actions.inspire = () => {
    const f = CS.FORMATS[cur], d = draft(cur);
    const pool = f.ideas.filter(i => i !== d.concept);
    d.concept = pool[Math.floor(Math.random() * pool.length)];
    CS.persist(); rerender();
  };

  function jobTitle(f, d, c) {
    const what = d.concept || d.url || d.product || '';
    return f.label + (c.creator ? ' · ' + c.creator.name : '') + (what ? ' — ' + CS.truncate(what, 44) : '');
  }

  function submit(status) {
    const f = CS.FORMATS[cur], d = draft(cur);
    if (CS.checkDraft(cur, d).missing.length) { CS.ui.toast('Fill in the missing items first.'); return; }
    const prompt = CS.buildPrompt(cur, d), c = CS.buildContext(d);
    if (status === 'sent') CS.copy(prompt, true);
    CS.S.jobs.unshift({ id: CS.nid('j'), type: cur, title: jobTitle(f, d, c), prompt, status, credits: 0, note: '', createdAt: CS.now(), draft: CS.clone(d) });
    // keep cast / look / brand / format settings so batches are quick; clear the per-video bits
    Object.assign(d, { concept: '', url: '', notes: '', product: '', cta: '', audioText: '', audioFile: null });
    CS.save();
    CS.ui.toast(status === 'sent' ? 'Copied — and added to the queue.' : 'Saved as a draft in the queue.', { label: 'Open queue', fn: () => CS.go('queue') });
  }
  CS.actions.createSend = () => submit('sent');
  CS.actions.createDraft = () => submit('draft');
  CS.actions.createReset = () => CS.ui.confirm('Clear everything you entered for this format?', () => { CS.S.drafts[cur] = CS.blankDraft(cur); CS.save(); }, { yes: 'Reset', title: 'Reset form' });

  // used by other screens
  CS.create = {
    // start a new video with this creator, keeping the current format if it takes a creator
    withCreator(id) {
      const fid = CS.FORMATS[CS.S.lastFormat] ? CS.S.lastFormat : 'ugc';
      applyCreator(fid, id); CS.persist(); CS.go('create/' + fid);
    },
    // load a saved job's form back into Create (edit / duplicate)
    loadJob(job) {
      if (!job.draft || !CS.FORMATS[job.type]) return false;
      CS.S.drafts[job.type] = Object.assign(CS.blankDraft(job.type), CS.clone(job.draft));
      CS.S.lastFormat = job.type; CS.persist(); CS.go('create/' + job.type);
      return true;
    }
  };
})(window.CS);
