/* Produce: connects the tested engine (factory.js) to the app — settings, media storage, uploads, the production screen.
   A "production" is a job with job.run (see factory.js). Everything the engine needs from the browser comes from P.deps(). */
(function (CS) {
  const esc = CS.esc, R = window.CSRecipes, E = window.CSFactory, K = window.CSKit, H = window.CSHiggs, M = CS.media;
  const P = CS.produce = {};

  /* ---------- settings & client ---------- */
  P.settings = () => CS.S.settings.higgs;
  P.ready = () => { const h = P.settings(); return h.mode === 'direct' ? !!(h.keyId && h.keySecret && h.ack) : h.mode === 'proxy' ? !!h.proxyUrl : false; };
  P.client = () => { const h = P.settings(); return H.createClient({ mode: h.mode, keyId: h.keyId, keySecret: h.keySecret, proxyUrl: h.proxyUrl, proxyToken: h.proxyToken, baseUrl: h.baseUrl || undefined }); }; // baseUrl: test hook only (points at the mock server)
  P.budget = E.makeBudget(() => CS.S.jobs, () => P.settings().caps, () => Date.now());
  const usd = n => '$' + (n < 0.1 ? n.toFixed(3) : n.toFixed(2));

  /* ---------- file helpers ---------- */
  P.dataUrlToBlob = u => { const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(u); const bin = atob(decodeURIComponent(m[3])), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: m[1] }); };

  P.probeVideo = file => new Promise(res => {
    const v = document.createElement('video'), u = URL.createObjectURL(file); v.preload = 'metadata';
    v.onloadedmetadata = () => { res({ secs: v.duration, w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(u); };
    v.onerror = () => { res({ secs: 0 }); URL.revokeObjectURL(u); }; v.src = u;
  });
  P.probeAudio = async blob => { const b = await P.decodeAudio(blob); return { secs: b.duration }; };
  P.decodeAudio = async blob => {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) throw new Error('This browser can’t read audio files.');
    const ctx = new C();
    try { return await ctx.decodeAudioData(await blob.arrayBuffer()); }
    catch (e) { throw new Error('Couldn’t read that audio. Use a normal MP3, WAV or M4A file (for “original audio”, the video must have sound).'); }
    finally { if (ctx.close) ctx.close(); }
  };
  // 16-bit PCM WAV of the first `maxSecs` seconds — Higgsfield takes WAV audio, at most 15s
  P.toWav = (buf, maxSecs) => {
    const ch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate, n = Math.min(buf.length, Math.round(maxSecs * sr));
    const out = new DataView(new ArrayBuffer(44 + n * ch * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
    const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
    return new Blob([out.buffer], { type: 'audio/wav' });
  };

  /* ---------- kit for a finished file ---------- */
  P.kitFor = (job, opt) => {
    const d = job.draft || {}, c = CS.buildContext(d), h = P.settings();
    const hash = String(job.id).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const first = (d.beats && d.beats[0] && d.beats[0].say) || '';
    const kit = K.build({ format: job.type, concept: d.concept, product: d.product, cta: d.cta, creator: c.creator, brand: c.brand, hook: first, disclose: h.disclose !== false, seed: hash });
    return { kit, text: K.toText(kit, { title: job.title, date: CS.today() }) };
  };

  /* ---------- engine dependencies ---------- */
  P.deps = () => {
    const h = P.settings();
    return {
      client: P.client(), R, kit: K, now: () => Date.now(), persist: () => CS.persist(), onChange: P.changed,
      settings: { autoBelowUsd: h.autoBelowUsd || 0 }, maxParallel: h.maxParallel || 3,
      refSources: async j => R.collectRefs(CS.buildContext(j.draft)).map(r => ({ key: r.key, src: r.src })),
      dataUrlToBlob: P.dataUrlToBlob,
      getAudio: async (j, step) => {
        const src = await M.getTemp('in:' + j.id + (step.fromVideo ? ':video' : ':audio'));
        if (!src) throw new Error('The audio file is missing — go back to Create and add it again.');
        return P.toWav(await P.decodeAudio(src), step.secs || 15);
      },
      getRefVideo: async j => { const b = await M.getTemp('in:' + j.id + ':video'); if (!b) throw new Error('The video is missing — go back to Create and add it again.'); return b.type === 'video/mp4' ? b : new Blob([b], { type: 'video/mp4' }); },
      temp: { put: M.putTemp, get: M.getTemp, del: M.delTemp },
      promote: async (j, blob, o) => {
        const isVid = o.step.type === 'video', k = P.kitFor(j);
        const rec = await M.add({ blob, kind: isVid ? 'vid' : 'pic', creatorId: (j.draft && j.draft.creatorId) || '', source: 'api', jobId: j.id, prompt: o.step.prompt, kit: k.text, name: isVid ? 'clip.mp4' : 'photo.png' });
        return rec;
      },
      budget: P.budget
    };
  };

  let changeTimer;
  P.changed = () => { clearTimeout(changeTimer); changeTimer = setTimeout(() => { if (CS.route().id === 'produce') CS.render(); }, 120); };

  /* ---------- create / start / advance ---------- */
  const jobTitle = (fid, d, c) => CS.FORMATS[fid].label + (c.creator ? ' · ' + c.creator.name : '') + (d.concept || d.url ? ' — ' + CS.truncate(d.concept || d.url, 40) : '');

  // Build the plan for a Create draft (no spend, no network)
  P.planFor = (fid, d) => R.plan(fid, d, Object.assign({}, CS.buildContext(d), { style: d.style, notes: d.notes }));

  P.create = async (fid, d, inputs) => {
    const c = CS.buildContext(d), plan = P.planFor(fid, d);
    if (plan.errors.length) return { errors: plan.errors };
    const job = { id: CS.nid('j'), type: fid, title: jobTitle(fid, d, c), prompt: '(made in app — see production)', status: 'sent', lane: 'api', credits: 0, note: '', createdAt: CS.now(), draft: CS.clone(d) };
    if (inputs) for (const k of ['audio', 'video']) { const b = await M.getTemp(`in:draft:${fid}:${k}`); if (b) await M.putTemp(`in:${job.id}:${k}`, b); }
    E.init(job, plan, P.deps()); CS.S.jobs.unshift(job); CS.persist();
    return { job };
  };

  // start the free preparation, then price the first paid step (nothing is spent yet)
  P.start = async id => {
    const job = CS.find.job(id); if (!job || !job.run) return;
    if (!P.ready()) { CS.ui.toast('Set up your Higgsfield API access first.', { label: 'Settings', fn: () => CS.go('settings') }); return; }
    job.run.state = 'running'; CS.persist();
    const deps = P.deps();
    if (!await E.prepare(job, deps)) { P.changed(); return; }
    await P.advance(job);
  };

  // price the next paid step whose inputs are ready (drafts before finals, never automatically the optional final)
  P.advance = async job => {
    const deps = P.deps(), steps = job.run.plan.steps, rt = job.run.rt;
    if (steps.some(s => s.status === 'confirm' || s.status === 'running' || s.status === 'estimating' || s.status === 'review')) return;
    const next = steps.find(s => s.model && !s.optional && s.status === 'planned' && (s.needs !== 'still' || rt.stillUrl));
    if (next) await E.estimate(job, next.id, deps);
    if (E.isFinished(job)) { job.status = 'done'; CS.persist(); }
  };

  P.cleanup = async job => { for (const k of E.tempKeys(job)) await M.delTemp(k).catch(() => {}); };

  P.resumeAll = async () => {
    if (!P.ready()) return;
    for (const job of CS.S.jobs) {
      if (!job.run || job.run.state === 'done') continue;
      try { await E.resume(job, P.deps()); } catch (e) { console.error(e); }
    }
  };

  /* ---------- the production screen ---------- */
  const STATUS = { planned: ['⚪', 'Waiting'], estimating: ['⏳', 'Pricing…'], confirm: ['💲', 'Ready — confirm the price'], running: ['⏳', 'Generating'], review: ['👀', 'Ready for you'], done: ['✅', 'Done'], failed: ['❌', 'Problem'], skipped: ['—', 'Skipped'] };
  const ITEM = { idle: 'waiting', submitting: 'sending…', queued: 'queued at Higgsfield', in_progress: 'generating', completed: 'ready', failed: 'failed — not charged', nsfw: 'blocked by moderation — not charged', canceled: 'canceled', uncertain: 'unclear — check before retrying', stalled: 'taking long — still running' };

  function itemHtml(job, s, it) {
    const act = [];
    if (['queued'].includes(it.status)) act.push(`<button class="btn small ghost" data-action="pCancel" data-job="${job.id}" data-step="${s.id}" data-item="${it.id}">Cancel</button>`);
    if (['stalled', 'uncertain'].includes(it.status) && it.requestId) act.push(`<button class="btn small secondary" data-action="pCheck" data-job="${job.id}" data-step="${s.id}" data-item="${it.id}">Check again</button>`);
    if (['failed', 'nsfw', 'canceled', 'uncertain', 'stalled'].includes(it.status)) act.push(`<button class="btn small ghost" data-action="pRetry" data-job="${job.id}" data-step="${s.id}" data-item="${it.id}">${it.status === 'uncertain' ? 'I checked — try again' : 'Try again'}</button>`);
    const isVid = s.type === 'video';
    let media = '';
    if (it.status === 'completed') {
      if (it.tempKey) media = isVid ? `<video class="p-media" data-tmp="${esc(it.tempKey)}" controls playsinline preload="metadata"></video>` : `<img class="p-media" data-tmp="${esc(it.tempKey)}" alt="">`;
      else if (it.approved) media = `<div class="muted">Saved to Files ✓</div>`;
      else media = `<div class="err-line">${esc(it.downloadError || 'Not saved yet')} <button class="btn small secondary" data-action="pRedl" data-job="${job.id}" data-step="${s.id}" data-item="${it.id}">Retry download</button> ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">Open link</a>` : ''}</div>`;
    }
    if (it.status === 'completed' && !it.approved && !it.dropped && it.tempKey) {
      if (s.gate === 'pick') act.push(`<button class="btn small" data-action="pPick" data-job="${job.id}" data-step="${s.id}" data-item="${it.id}">Use this one</button>`);
      else if (s.gate === 'keep') act.push(`<button class="btn small" data-action="pKeep" data-job="${job.id}" data-step="${s.id}" data-item="${it.id}">Keep</button><button class="btn small ghost" data-action="pDrop" data-job="${job.id}" data-step="${s.id}" data-item="${it.id}">Drop</button>`);
      else act.push(`<button class="btn small green" data-action="pApprove" data-job="${job.id}" data-step="${s.id}" data-item="${it.id}">Approve &amp; save to Files</button>`);
    }
    if (it.dropped) return '';
    return `<div class="p-item">${media}<div class="muted">${it.picked ? '⭐ chosen · ' : ''}${esc(ITEM[it.status] || it.status)}${it.error ? ' — ' + esc(it.error) : ''}</div><div class="row">${act.join('')}</div></div>`;
  }

  function stepHtml(job, s) {
    const [icon, label] = STATUS[s.status] || ['', s.status];
    const m = s.model ? R.MODELS[s.model] : null;
    let body = '';
    const rt = job.run.rt, deps = !s.needs || rt.stillUrl;
    if (s.type === 'refs' || s.type === 'audio' || s.type === 'upload-video') {
      body = s.status === 'failed' ? `<div class="err-line">${esc(s.error)}</div><button class="btn small secondary" data-action="pStart" data-job="${job.id}">Try the uploads again</button>` : '';
      if (s.type === 'refs' && s.items) body += '';
    } else if (s.status === 'planned') {
      body = deps ? `<button class="btn small secondary" data-action="pEstimate" data-job="${job.id}" data-step="${s.id}">${s.optional ? 'Make the final (higher quality)' : 'Get the exact price'}</button>` : '<span class="muted">Waiting for the previous step.</span>';
    } else if (s.status === 'confirm') {
      const chk = P.budget.check(job, s.estimate.usd); // shown up front, so a cap never surprises after a click
      const blocked = !chk.ok ? `<div class="err-line">${esc(chk.reason)} <a href="#/settings">Change caps</a></div>` : '';
      body = `<div class="p-price"><b>${usd(s.estimate.usd)}</b><span class="muted">${s.n > 1 ? `${s.n} × ${usd(s.estimate.each)} ` : ''}exact price from Higgsfield · charged only if it succeeds</span></div>${blocked}
        <div class="row"><button class="btn green" data-action="pConfirm" data-job="${job.id}" data-step="${s.id}" ${chk.ok ? '' : 'disabled'}>Confirm &amp; generate</button><button class="btn ghost small" data-action="pDiscard" data-job="${job.id}" data-step="${s.id}">Not now</button></div>`;
    } else if (s.status === 'running' || s.status === 'review' || s.status === 'failed' || s.status === 'done') {
      body = (s.items || []).map(it => itemHtml(job, s, it)).join('');
      if (s.status === 'failed' && !(s.items || []).length) body += `<div class="err-line">${esc(s.error || 'Something went wrong.')}</div><button class="btn small secondary" data-action="pEstimate" data-job="${job.id}" data-step="${s.id}">Try again</button>`;
      if (s.status === 'running') body += '<div class="muted">Higgsfield is working on it. You can leave this page — it keeps going and is picked up again when you return.</div>';
      if (s.status === 'review' && s.gate !== 'keep') body += `<div class="row"><button class="btn ghost small" data-action="pDiscard" data-job="${job.id}" data-step="${s.id}">Discard &amp; redo</button></div>`;
      if (s.status === 'done' && s.type === 'video') { const it = (s.items || []).find(i => i.approved); const rec = it && M.items.find(x => x.id === it.mediaId); if (rec) body += `<div class="row"><button class="btn small" data-action="pDownload" data-id="${rec.id}">⬇ Download video + caption</button><button class="btn small secondary" data-action="pKit" data-id="${rec.id}">Caption &amp; tags</button></div>`; }
    }
    const prompt = s.prompt && ['planned', 'failed', 'confirm'].includes(s.status) && s.model ? `<details><summary class="muted">Prompt${s.params && s.params.multi_prompt ? ' (+ ' + s.params.multi_prompt.length + ' shots)' : ''}</summary><textarea class="p-prompt" data-bind="produce.prompt" data-job="${job.id}" data-step="${s.id}">${esc(s.prompt)}</textarea>${(s.params && s.params.multi_prompt || []).map((x, i) => `<pre class="prompt">Shot ${i + 1} · ${x.duration}s — ${esc(x.prompt)}</pre>`).join('')}</details>` : '';
    return `<section class="step p-step ${s.status}"><div class="step-head"><span class="p-ico">${icon}</span><h2>${esc(s.label)}</h2><span class="muted">${m ? esc(m.label) + ' · ' : ''}${label}</span></div>${body}${prompt}</section>`;
  }

  CS.views.produce = {
    render(params) {
      const job = CS.find.job(params[0]);
      if (!job || !job.run) return `<div class="empty">That production doesn’t exist.<br><a class="btn small" href="#/queue">Back to the Queue</a></div>`;
      const t = E.totals(job), h = P.settings(), now = new Date(), day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const started = job.run.state !== 'planned';
      const plan = { steps: job.run.plan.steps };
      const approx = plan.steps.filter(s => s.model && !s.optional).reduce((a, s) => { const m = R.MODELS[s.model]; return a + (m.kind === 'image' ? (m.approx.image || 0) * (s.n || 1) : (m.approx.sec != null ? m.approx.sec * (s.params.duration || 5) : 0)); }, 0);
      const setup = P.ready() ? '' : `<div class="card"><h2>Set up Higgsfield access</h2><p class="muted">Making videos inside the app uses Higgsfield’s API — a separate prepaid balance (from $5) that is <b>not</b> your $59 plan credits. Add your key in Settings.</p><a class="btn" href="#/settings">Open Settings</a></div>`;
      const intro = !started ? `<div class="card"><h2>Ready to produce</h2>
        <p class="muted">Nothing is spent yet. The app first uploads your reference photos (free), then asks Higgsfield for the <b>exact price</b> of each step and waits for your OK. List prices suggest about <b>${usd(approx)}</b> for the first draft.</p>
        <button class="btn big" data-action="pStart" data-job="${job.id}">🚀 Start production</button></div>` : '';
      const done = E.isFinished(job) ? `<div class="card"><h2>🎉 Finished</h2><p class="muted">Your file is in <a href="#/files/${encodeURIComponent(M.folderFor((job.draft || {}).creatorId))}">Files</a> with its caption &amp; tags next to it. Want higher quality? Use “Make the final” above.</p></div>` : '';
      return `
        <div class="page-head"><div><a href="#/queue">← Queue</a><h1 style="margin-top:4px;">${esc(job.title)}</h1><p class="muted">Made in the app · ${esc(CS.FORMATS[job.type] ? CS.FORMATS[job.type].label : job.type)}</p></div>
          <div class="p-spend"><b>${usd(t.charged)}</b> spent<div class="muted">${t.reserved > 0 ? usd(t.reserved) + ' in progress · ' : ''}today ${usd(P.budget.spentSince(day))}${h.caps.daily ? ' / ' + usd(h.caps.daily) : ''} · month ${usd(P.budget.spentSince(month))}${h.caps.monthly ? ' / ' + usd(h.caps.monthly) : ''}</div></div></div>
        ${setup}${intro}
        ${job.run.plan.steps.map(s => stepHtml(job, s)).join('')}
        ${done}
        <details class="card"><summary class="muted">Activity log</summary>${job.run.events.slice().reverse().map(e => `<div class="muted">${new Date(e.t).toLocaleTimeString()} — ${esc(e.msg)}</div>`).join('')}</details>`;
    },
    after() { M.hydrate(); }
  };

  const J = d => CS.find.job(d.job);
  CS.binds.produce = (f, el) => { if (f === 'prompt') { const j = CS.find.job(el.dataset.job), s = j && j.run.plan.steps.find(x => x.id === el.dataset.step); if (s) { s.prompt = el.value; CS.persist(); } } };
  CS.actions.pStart = d => P.start(d.job);
  CS.actions.pEstimate = async d => { const j = J(d); if (!j) return; if (!P.ready()) { CS.ui.toast('Set up Higgsfield access first.', { label: 'Settings', fn: () => CS.go('settings') }); return; } await E.estimate(j, d.step, P.deps()); };
  CS.actions.pConfirm = async d => { const j = J(d); if (!j) return; const r = await E.confirm(j, d.step, P.deps()); if (!r.ok && r.reason) CS.ui.toast(r.reason); P.changed(); };
  CS.actions.pDiscard = async d => { const j = J(d); if (!j) return; await E.discard(j, d.step, P.deps()); await P.advance(j); };
  CS.actions.pCancel = async d => { const j = J(d); if (j && !await E.cancelItem(j, d.step, d.item, P.deps())) CS.ui.toast('Too late to cancel — it has already started.'); };
  CS.actions.pCheck = d => { const j = J(d); if (j) E.check(j, d.step, d.item, P.deps()); };
  CS.actions.pRetry = d => { const j = J(d); if (!j) return; CS.ui.confirm(`Try this again? It may be charged again${(j.run.plan.steps.find(s => s.id === d.step).items.find(i => i.id === d.item) || {}).status === 'uncertain' ? ' if the first attempt actually went through' : ''}.`, () => E.retryItem(j, d.step, d.item, P.deps()), { yes: 'Try again', danger: false, title: 'Try again?' }); };
  CS.actions.pRedl = async d => { const j = J(d); if (j) { const ok = await E.retryDownload(j, d.step, d.item, P.deps()); if (!ok) CS.ui.toast('Still blocked. Use “Open link” and save it from there.'); P.changed(); } };
  CS.actions.pPick = async d => { const j = J(d); if (j && await E.pick(j, d.step, d.item, P.deps())) await P.advance(j); };
  CS.actions.pKeep = async d => { const j = J(d); if (!j) return; const rec = await E.keep(j, d.step, d.item, P.deps()); if (rec) { if (E.isFinished(j)) { j.status = 'done'; CS.persist(); } CS.ui.toast('Saved to Files.'); } };
  CS.actions.pDrop = async d => { const j = J(d); if (j) await E.dropItem(j, d.step, d.item, P.deps()); };
  CS.actions.pApprove = async d => {
    const j = J(d); if (!j) return; const rec = await E.approve(j, d.step, d.item, P.deps());
    if (!rec) { CS.ui.toast('Couldn’t save that file — see the message on the step.'); return; }
    if (E.isFinished(j)) { j.status = 'done'; CS.persist(); }
    CS.ui.toast('Saved to Files, with its caption & tags.'); P.changed();
  };
  CS.actions.pDownload = async d => { const rec = M.items.find(x => x.id === d.id); if (!rec) return; if (rec.kit) { const first = rec.kit.split('Caption:\n')[1]; if (first) CS.copy(first.split('\n\n')[0], true); } await M.saveToDevice([rec]); CS.ui.toast('Downloaded — the caption is copied and its .txt is next to the video.'); };
  CS.actions.pKit = d => {
    const rec = M.items.find(x => x.id === d.id); if (!rec || !rec.kit) return;
    CS.ui.modal({ title: 'Caption & tags', wide: true, body: `<pre class="prompt tall">${esc(rec.kit)}</pre>`, footer: `<button class="btn secondary" data-action="copyPromptText" data-text="${esc(rec.kit)}">Copy all</button><button class="btn" data-action="closeModal">Close</button>` });
  };

  /* ---------- connection test (free: uses the estimate endpoint) ---------- */
  P.test = async () => {
    try {
      const e = await P.client().estimate('higgsfield-ai/soul/v2/standard', { prompt: 'connection test', aspect_ratio: '1:1', resolution: '720p' });
      return { ok: true, msg: `Connected ✓ — Higgsfield answered. A test picture would cost ${usd(e.usd)} (no charge for this check).` };
    } catch (e) { return { ok: false, msg: e.message || String(e) }; }
  };
})(window.CS);
