/* Creators: list, profile, and the 5-step create/edit wizard. */
(function (CS) {
  const esc = CS.esc;
  let gFilter = 'all';
  const BODY = {
    male: ['Lean athletic', 'Muscular built', 'Average/casual', 'Tall slim', 'Stocky broad'],
    female: ['Slim toned', 'Curvy hourglass', 'Athletic fit', 'Petite slim', 'Tall model-lean']
  };
  const ETH = ['Middle Eastern', 'South Asian', 'East Asian', 'Southeast Asian', 'Black/African', 'White/Caucasian', 'Latino/Hispanic', 'Mixed'];

  function identityPrompt(c) {
    return `SOUL ID CREATOR SETUP
Name: ${c.name}
Gender: ${c.gender}
Ethnicity: ${c.ethnicity}
Body type: ${c.bodyType}
Age range: ${c.age || '20s-30s'}
Profession / persona: ${c.profession}
Niche: ${c.niche}
Face reference photos: ${(c.faceRefs || []).length} attached (use for Soul ID training, real photorealistic likeness)
Clothing description for base look: ${c.clothingDesc || '(none yet — see wardrobe items)'}
Voice: ${c.voiceName || '(not set)'} — save as a locked Higgsfield Audio preset/clone for this creator, reuse on every video, never regenerate a new voice for them.
Deliverables needed:
1. Train/confirm Soul ID from the reference photos, 100% photorealistic.
2. Generate 4 reference shots: far/full body, medium distance, close-up face, 3/4 side angle.
3. Save the identity as a reusable character named "${c.name}" for reuse across all future generations.
Do not alter face, body type, or voice after this is confirmed — this identity is locked once I approve it.`;
  }

  /* ---------- list ---------- */
  CS.views.creators = {
    render() {
      const list = CS.S.creators.filter(c => gFilter === 'all' || c.gender === gFilter);
      const seg = [['all', 'All'], ['male', 'Male'], ['female', 'Female']].map(x => `<button class="${gFilter === x[0] ? 'active' : ''}" data-action="cFilter" data-v="${x[0]}">${x[1]}</button>`).join('');
      const cards = list.map(c => `
        <div class="item">
          <div class="row" style="flex-wrap:nowrap;">${CS.avatar(c, true)}
            <div style="min-width:0;"><h4>${esc(c.name)}</h4><div class="muted">${esc(c.profession || '—')} · ${esc(c.niche || '—')}</div></div></div>
          <div style="margin:8px 0;">${c.locked ? '<span class="tag locked">🔒 locked</span>' : '<span class="tag draft">draft</span>'}<span class="tag">${esc(c.bodyType || '—')}</span><span class="tag">${esc(c.ethnicity || '—')}</span><span class="tag">${esc(c.voiceName || 'no voice')}</span></div>
          <div class="row">
            <button class="btn small" data-action="cCreate" data-id="${c.id}">✨ Create</button>
            <button class="btn small secondary" data-action="cOpen" data-id="${c.id}">Profile</button>
          </div>
        </div>`).join('');
      return `
        <div class="page-head"><div><h1>Creators</h1><p class="muted">Your AI cast. Lock a creator once and their face, body and voice stay consistent in every video.</p></div><button class="btn" data-action="wizOpen">＋ New creator</button></div>
        <div class="row" style="margin-bottom:14px;"><div class="seg">${seg}</div><span class="muted">${list.length} shown</span></div>
        ${list.length ? `<div class="grid">${cards}</div>` : `<div class="empty">${CS.S.creators.length ? 'No creators in this filter.' : 'No creators yet.<br><button class="btn small" data-action="wizOpen">Create your first creator</button>'}</div>`}`;
    }
  };
  CS.actions.cFilter = d => { gFilter = d.v; CS.render(); };
  CS.actions.cCreate = d => CS.create.withCreator(d.id);

  /* ---------- profile modal ---------- */
  CS.actions.cOpen = d => {
    const c = CS.find.creator(d.id); if (!c) return;
    const S = CS.S;
    const checks = (items, ids, kind) => items.length
      ? `<div class="chips">${items.map(x => `<label class="chip"><input type="checkbox" data-bind="assign.${kind}" data-cid="${c.id}" value="${x.id}" ${ids.indexOf(x.id) >= 0 ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}</div>`
      : '<span class="muted">None yet — add some in the Library.</span>';
    const prompt = identityPrompt(c);
    CS.ui.modal({
      title: c.name, wide: true,
      body: `<div class="row" style="flex-wrap:nowrap;margin-bottom:12px;">${CS.avatar(c, true)}<div>
          <div>${c.locked ? '<span class="tag locked">🔒 locked</span> Identity is fixed.' : '<span class="tag draft">draft</span> Not locked yet.'}</div>
          <div class="muted">${esc([c.gender, c.ethnicity, c.bodyType, c.age].filter(Boolean).join(' · '))}</div>
          <div class="muted">${esc(c.profession || '')}${c.niche ? ' · ' + esc(c.niche) : ''} · voice: ${esc(c.voiceName || 'not set')}</div></div></div>
        ${(c.faceRefs || []).length ? `<div class="imgrow" style="margin-bottom:12px;">${c.faceRefs.map(f => `<img class="imgprev" src="${f}" alt="">`).join('')}</div>` : ''}
        <h3>Default outfits</h3><div style="margin:6px 0 14px;">${checks(S.wardrobe, c.wardrobeIds, 'wardrobeIds')}</div>
        <h3>Default backgrounds</h3><div style="margin:6px 0 14px;">${checks(S.backgrounds, c.backgroundIds, 'backgroundIds')}</div>
        <div class="muted" style="margin-bottom:12px;">These are pre-selected in Create when you pick this creator.</div>
        <h3>Identity prompt</h3><pre class="prompt">${esc(prompt)}</pre>`,
      footer: `<button class="btn danger small" data-action="cDelete" data-id="${c.id}">Delete</button><span class="spacer"></span>
        <a class="btn secondary small" href="#/files/${encodeURIComponent(CS.media.folderFor(c.id))}">📁 Files (${CS.media.items.filter(m => m.creatorId === c.id).length})</a>
        <button class="btn secondary small" data-action="cCopyPrompt" data-id="${c.id}">Copy identity prompt</button>
        ${c.locked ? '' : `<button class="btn secondary small" data-action="wizOpen" data-id="${c.id}">Edit</button><button class="btn green small" data-action="cLock" data-id="${c.id}">Confirm &amp; lock</button>`}
        <button class="btn small" data-action="cCreateClose" data-id="${c.id}">✨ Create with ${esc(c.name)}</button>`
    });
  };
  CS.binds.assign = (kind, el) => {
    const c = CS.find.creator(el.dataset.cid); if (!c) return;
    c[kind] = Array.from(document.querySelectorAll(`input[data-bind="assign.${kind}"][data-cid="${c.id}"]:checked`)).map(i => i.value);
    CS.persist();
  };
  CS.actions.cCopyPrompt = d => { const c = CS.find.creator(d.id); if (c) CS.copy(identityPrompt(c)); };
  CS.actions.cCreateClose = d => { CS.ui.closeModal(); CS.create.withCreator(d.id); };
  CS.actions.cDelete = d => CS.ui.confirm('Delete this creator? Videos already in the queue keep their prompts.', () => {
    CS.S.creators = CS.S.creators.filter(c => c.id !== d.id); CS.ui.closeModal(); CS.save();
  });
  CS.actions.cLock = d => {
    const c = CS.find.creator(d.id); if (!c) return;
    if (!c.voiceName) { CS.ui.toast('Set a voice before locking (Edit → Voice).'); return; }
    c.locked = true; CS.ui.closeModal(); CS.save(); CS.ui.toast('Locked — face, body and voice are now fixed.');
  };

  /* ---------- wizard ---------- */
  let wiz = null, step = 0;
  const STEPS = ['Basics', 'Face', 'Look', 'Voice', 'Review'];

  CS.actions.wizOpen = d => {
    const ex = d && d.id ? CS.find.creator(d.id) : null;
    wiz = ex ? CS.clone(ex) : { name: '', gender: gFilter === 'female' ? 'female' : 'male', ethnicity: '', bodyType: '', age: '20s-30s', profession: '', niche: '', faceRefs: [], clothingDesc: '', voiceMode: 'preset', voiceName: '', locked: false, wardrobeIds: [], backgroundIds: [] };
    wiz.editId = ex ? ex.id : null;
    step = 0; renderWiz();
  };

  const F = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const inp = (k, ph) => `<input type="text" data-bind="wiz.${k}" value="${esc(wiz[k])}" ${ph ? `placeholder="${esc(ph)}"` : ''}>`;

  function renderWiz() {
    let b = '';
    if (step === 0) {
      b = F('Gender', `<div class="seg"><button class="${wiz.gender === 'male' ? 'active' : ''}" data-action="wizGender" data-v="male">Male</button><button class="${wiz.gender === 'female' ? 'active' : ''}" data-action="wizGender" data-v="female">Female</button></div>`)
        + F('Name', inp('name')) + F('Profession / persona', inp('profession', 'e.g. fitness coach, finance bro, cooking mom'))
        + F('Niche / content angle', inp('niche', 'e.g. gym tips, budgeting hacks')) + F('Age range', inp('age'));
    } else if (step === 1) {
      b = F('Face reference photos (for Soul ID training)', '<input type="file" accept="image/*" multiple data-bind="wiz.faces">')
        + `<div class="imgrow">${wiz.faceRefs.map((f, i) => `<span style="position:relative;"><img class="imgprev" src="${f}" alt=""><button class="icon-btn" style="position:absolute;top:-8px;right:-8px;background:var(--panel);border:1px solid var(--border);padding:0 5px;font-size:12px;" data-action="wizDropFace" data-i="${i}" aria-label="Remove">✕</button></span>`).join('')}</div>
        <p class="muted">Photos are shrunk and stay in this browser. When you generate, attach the same photos in the Claude chat so Higgsfield can train Soul ID.</p>`;
    } else if (step === 2) {
      b = F('Ethnicity', `<select data-bind="wiz.ethnicity"><option value="">Select</option>${ETH.map(e => `<option ${wiz.ethnicity === e ? 'selected' : ''}>${e}</option>`).join('')}</select>`)
        + F('Body type', `<select data-bind="wiz.bodyType"><option value="">Select</option>${BODY[wiz.gender].map(x => `<option ${wiz.bodyType === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)
        + F('Base clothing description', `<textarea data-bind="wiz.clothingDesc" placeholder="e.g. fitted black t-shirt, grey joggers, minimal jewelry">${esc(wiz.clothingDesc)}</textarea>`)
        + '<p class="muted">Detailed outfits go in the Library. This is just the default look for the 4 reference shots.</p>';
    } else if (step === 3) {
      b = F('Voice source', `<select data-bind="wiz.voiceMode"><option value="preset" ${wiz.voiceMode === 'preset' ? 'selected' : ''}>Higgsfield preset (Seed Audio)</option><option value="clone" ${wiz.voiceMode === 'clone' ? 'selected' : ''}>Cloned voice (your own sample, rights-cleared)</option></select>`)
        + F('Voice name / label', `<input type="text" data-bind="wiz.voiceName" value="${esc(wiz.voiceName)}" placeholder="${wiz.voiceMode === 'preset' ? 'e.g. Preset: Deep calm male' : 'e.g. Clone: my-sample-v1'}">`)
        + '<p class="muted">Saved with the creator and reused on every video — never regenerated per video.</p>';
    } else {
      b = `<table>${[['Name', wiz.name], ['Gender', wiz.gender], ['Profession', wiz.profession], ['Niche', wiz.niche], ['Ethnicity', wiz.ethnicity], ['Body type', wiz.bodyType], ['Face photos', wiz.faceRefs.length + ' photo(s)'], ['Voice', wiz.voiceName]].map(r => `<tr><th>${r[0]}</th><td>${esc(r[1]) || '<span class="muted">—</span>'}</td></tr>`).join('')}</table>
        <p class="muted">Saved as a draft. Use “Confirm &amp; lock” on the profile once you’re happy with the generated Soul ID — after that face, body and voice can’t be edited.</p>`;
    }
    CS.ui.modal({
      title: wiz.editId ? 'Edit creator' : 'New creator',
      body: `<div class="stepbar">${STEPS.map((s, i) => `<div class="${i <= step ? 'on' : ''}" title="${s}"></div>`).join('')}</div><div class="muted" style="margin-bottom:10px;">Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}</div>${b}`,
      footer: `<button class="btn secondary" data-action="wizBack">${step === 0 ? 'Cancel' : 'Back'}</button><button class="btn" data-action="wizNext">${step === 4 ? 'Save creator' : 'Next'}</button>`
    });
  }

  CS.binds.wiz = (k, el) => {
    if (!wiz) return;
    if (k === 'faces') {
      const files = Array.from(el.files || []);
      Promise.all(files.map(f => CS.readImage(f, 512))).then(imgs => { wiz.faceRefs = wiz.faceRefs.concat(imgs.filter(Boolean)); renderWiz(); });
    } else if (k === 'voiceMode') { wiz.voiceMode = el.value; renderWiz(); }
    else wiz[k] = el.value;
  };
  CS.actions.wizGender = d => { wiz.gender = d.v; wiz.bodyType = ''; renderWiz(); };
  CS.actions.wizDropFace = d => { wiz.faceRefs.splice(+d.i, 1); renderWiz(); };
  CS.actions.wizBack = () => { if (step === 0) { wiz = null; CS.ui.closeModal(); return; } step--; renderWiz(); };
  CS.actions.wizNext = () => {
    if (step === 0 && !wiz.name.trim()) { CS.ui.toast('Give the creator a name.'); return; }
    if (step < 4) { step++; renderWiz(); return; }
    const id = wiz.editId; delete wiz.editId;
    let saved;
    if (id) { saved = CS.find.creator(id); Object.assign(saved, wiz); }
    else { wiz.id = CS.nid('cr'); CS.S.creators.push(wiz); saved = wiz; gFilter = 'all'; }
    CS.media.folderFor(saved.id); // fixes the folder name now, so later renames never move files
    CS.media.ensureFolders(saved).catch(() => {}); // Pics + Vids folders appear on the phone straight away (if connected)
    wiz = null; CS.ui.closeModal(); CS.save(); CS.ui.toast('Creator saved as draft.');
    CS.go('creators');
  };
})(window.CS);
