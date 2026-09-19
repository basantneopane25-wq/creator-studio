/* Create-screen extensions for producing inside the app: the script (beats) editor, the video-to-copy upload,
   the loop option and the "Make it in the app" box (live plan + price preview). Hooks are called from create.js. */
(function (CS) {
  const esc = CS.esc, R = window.CSRecipes;
  const X = CS.createExt = {};
  const api = () => CS.create.api;             // { draft(fid), cur(), rerender(), persist(), updateSide() }
  const SCRIPTED = ['ugc', 'story', 'brainrot'];
  const ctxFor = d => Object.assign({}, CS.buildContext(d), { concept: d.concept, product: d.product, cta: d.cta });
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;

  /* ---------- script beats: what we see / what they say / seconds ---------- */
  X.secScript = function (f, d) {
    if (!SCRIPTED.includes(f.id)) return '';
    const beats = d.beats || [];
    if (!beats.length) {
      return `<p class="muted">Leave this alone and the app writes a hook → proof → call-to-action script for you from the concept. Want to control every line and every second?</p>
        <button class="btn small secondary" type="button" data-action="beatsInit">✍️ Write the script for me (then edit)</button>`;
    }
    const total = beats.reduce((a, b) => a + (parseInt(b.secs, 10) || 0), 0);
    const rows = beats.map((b, i) => {
      const budget = R.wordBudget(parseInt(b.secs, 10) || 0), w = R.words(b.say), over = w > budget;
      const role = i === 0 ? ' · the hook' : (i === beats.length - 1 && beats.length > 1 ? ' · the finish' : '');
      return `<div class="beat"><div class="row between"><b>Beat ${i + 1}${role}</b>
        <span class="row"><label class="row" style="gap:4px;margin:0;">seconds <input type="number" min="1" max="15" style="width:64px;" data-bind="create.beatSecs" data-i="${i}" value="${esc(b.secs)}"></label>
        <button class="icon-btn" type="button" data-action="beatDel" data-i="${i}" aria-label="Remove beat">✕</button></span></div>
        <div class="field"><label>What we see</label><textarea data-bind="create.beatSee" data-i="${i}">${esc(b.see)}</textarea></div>
        <div class="field"><label>What they say <span class="${over ? 'err-line' : 'muted'}">(${w} of about ${budget} words that fit ${esc(b.secs)}s)</span></label><textarea data-bind="create.beatSay" data-i="${i}" placeholder="optional — leave empty for no speech">${esc(b.say)}</textarea></div></div>`;
    }).join('');
    return `${rows}<div class="row"><button class="btn small secondary" type="button" data-action="beatAdd" ${beats.length >= 6 ? 'disabled' : ''}>＋ Add a beat</button>
      <button class="btn small ghost" type="button" data-action="beatsInit">Reset to the suggestion</button>
      <span class="${total > 15 ? 'err-line' : 'muted'}">Total ${total}s of a 15s maximum · up to 6 beats</span></div>`;
  };

  /* ---------- copy a trend: the video itself ---------- */
  X.secCopyVideo = function (f, d) {
    if (f.id !== 'copy') return '';
    const v = d.refVideo;
    return field('Or upload the video to copy (MP4, 2–15 seconds) <span class="muted">— needed to make it in the app</span>', '<input type="file" accept="video/mp4,video/*" data-bind="create.refVideo">')
      + `<div class="muted" style="margin:-6px 0 12px;">${v ? `✓ ${esc(v.name)} · ${Math.round(v.secs || 0)}s · ${(v.size / 1e6).toFixed(1)} MB · ${esc(v.type || 'unknown type')}` : 'No video yet. Uploading is free; you pay per second of video generated.'}</div>`;
  };

  X.loopBox = function (f, d) {
    if (f.id !== 'brainrot' && f.id !== 'story') return '';
    return `<label class="row" style="gap:8px;margin:0 0 12px;"><input type="checkbox" data-bind="create.loop" ${d.loop ? 'checked' : ''}><span class="muted">Make it loop — the clip ends on its first frame (loops help replays)</span></label>`;
  };

  /* ---------- the "Make it in the app" box ---------- */
  X.apiBox = function (fid, f, d) {
    const P = CS.produce, plan = P.planFor(fid, d);
    const steps = plan.steps.filter(s => s.model).map(s => `<li>${esc((s.optional ? '(optional) ' : '') + s.label + ' — ' + R.MODELS[s.model].label + (s.n > 1 ? ' ×' + s.n : ''))}</li>`).join('');
    return `<div class="card api-box"><div class="row between"><h2>Make it in the app</h2><span class="tag ${P.ready() ? 'done' : 'draft'}">${P.ready() ? 'Higgsfield connected' : 'not set up'}</span></div>
      <ul class="p-steps">${steps}</ul>
      <div class="muted">≈ <b>$${plan.approxUsd.toFixed(2)}</b> for the first draft at list prices${plan.unknown ? ' (+ steps Higgsfield prices)' : ''}. You see the exact price and confirm before any money is spent.</div>
      ${plan.errors.length ? `<ul class="checklist miss">${plan.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      ${plan.warnings.length ? `<ul class="checklist warn">${plan.warnings.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      <button class="btn big" data-action="createProduce" ${plan.errors.length ? 'disabled' : ''}>🚀 Produce in app</button>
      ${P.ready() ? '' : '<div class="muted" style="margin-top:6px;">You can plan and price it here first, but running it needs the Higgsfield API — <a href="#/settings">set it up in Settings</a>.</div>'}
    </div>`;
  };

  /* ---------- form bindings (return true when handled) ---------- */
  X.bind = function (name, el, d) {
    const A = api();
    if (name === 'refVideo') {
      const file = el.files && el.files[0];
      if (!file) { d.refVideo = null; A.persist(); A.rerender(); return true; }
      CS.produce.probeVideo(file).then(m => {
        d.refVideo = { name: file.name, type: file.type || (/\.mp4$/i.test(file.name) ? 'video/mp4' : ''), secs: m.secs || 0, size: file.size };
        CS.media.putTemp('in:draft:' + A.cur() + ':video', file); A.persist(); A.rerender();
      });
      return true;
    }
    if (name === 'loop') { d.loop = !!el.checked; A.persist(); A.updateSide(); return true; }
    if (name === 'beatSee' || name === 'beatSay' || name === 'beatSecs') {
      const b = d.beats && d.beats[+el.dataset.i]; if (!b) return true;
      if (name === 'beatSee') b.see = el.value;
      else if (name === 'beatSay') b.say = el.value;
      else { b.secs = Math.max(1, Math.min(15, parseInt(el.value, 10) || 1)); A.persist(); A.rerender(); return true; }
      A.persist(); A.updateSide(); return true;
    }
    return false;
  };

  CS.actions.beatsInit = () => { const A = api(), d = A.draft(A.cur()); d.beats = R.defaultBeats(A.cur(), ctxFor(d), parseInt(d.duration, 10) || 15).map(b => Object.assign({}, b)); A.persist(); A.rerender(); };
  CS.actions.beatDel = el => { const A = api(), d = A.draft(A.cur()); d.beats.splice(+el.i, 1); A.persist(); A.rerender(); };
  CS.actions.beatAdd = () => { const A = api(), d = A.draft(A.cur()); if ((d.beats || []).length < 6) { d.beats.push({ see: '', say: '', secs: 3 }); A.persist(); A.rerender(); } };
  CS.actions.createProduce = async () => {
    const A = api(), d = A.draft(A.cur()), res = await CS.produce.create(A.cur(), d, true);
    if (res.errors) { CS.ui.toast(res.errors[0]); return; }
    CS.go('produce/' + res.job.id);
  };
})(window.CS);
