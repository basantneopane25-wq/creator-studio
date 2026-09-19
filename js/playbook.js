/* Playbook: the research behind every recipe, shown in the app so nothing is a black box. Content lives in recipes.js. */
(function (CS) {
  const esc = CS.esc, R = window.CSRecipes;

  CS.views.playbook = {
    render() {
      const P = R.PLAYBOOK;
      const demo = { creator: { name: 'Zayn', voiceName: 'Preset: Deep calm male', niche: 'car tech' }, product: 'GripMount holder', concept: 'stopped my phone flying off the dash', cta: 'Link in bio' };
      const beats = R.defaultBeats('ugc', demo, 15);
      const shot = R.klingShot(beats[0], demo);
      const rows = Object.keys(R.MODELS).map(k => { const m = R.MODELS[k]; const price = m.kind === 'image' ? (m.approx.image != null ? '$' + m.approx.image + ' / image' : '—') : (m.approx.sec != null ? '$' + m.approx.sec + ' / second' : 'priced by Higgsfield'); return `<tr><td>${esc(m.label)}</td><td>${m.kind}</td><td>${price}</td><td><code>${esc(m.id)}</code></td></tr>`; }).join('');
      const fmts = Object.keys(P.formats).map(id => { const f = P.formats[id], meta = CS.FORMATS[id]; return `<div class="item"><h4>${meta ? meta.icon + ' ' + esc(meta.label) : esc(id)}</h4><div class="muted"><b>Goal:</b> ${esc(f.goal)}</div><div class="muted" style="margin-top:4px;"><b>Flow:</b> ${esc(f.flow)}</div><div class="muted" style="margin-top:4px;"><b>Why:</b> ${esc(f.why)}</div></div>`; }).join('');
      return `
        <div class="page-head"><div><h1>Playbook</h1><p class="muted">How the factory decides what to do — and where each rule comes from. Researched September 2026; prices and features change, so the app always asks Higgsfield for the exact price before spending.</p></div></div>
        <div class="card"><h2>The rules</h2><ul class="todo">${P.principles.map(p => `<li><span class="dot" style="background:var(--accent);border-color:var(--accent);"></span><span class="t"><b>${esc(p[0])}.</b> <span class="muted">${esc(p[1])}</span></span></li>`).join('')}</ul></div>
        <h2 style="margin:18px 0 8px;">The recipes</h2><div class="grid">${fmts}</div>
        <div class="card" style="margin-top:14px;"><h2>What a shot prompt looks like</h2>
          <p class="muted">Scene first, then the labelled character with their speech (about ${R.WORDS_PER_SEC} words a second), then camera. For image-to-video the looks are never re-described — the starting frame carries them.</p>
          <pre class="prompt">${esc(shot)}</pre></div>
        <div class="card"><h2>Models used (Higgsfield API)</h2><div style="overflow:auto;"><table><tr><th>Model</th><th>Type</th><th>List price</th><th>Endpoint</th></tr>${rows}</table></div>
          <p class="muted">List prices seen in September 2026, some under launch discounts. Higgsfield’s free estimate endpoint is the authority and is checked before every spend.</p></div>
        <div class="card"><h2>Honest limits</h2><ul class="todo">
          <li><span class="dot"></span><span class="t">Identity comes from reference photos, or from a Soul ID you trained on higgsfield.ai and pasted into the creator (used for stills when the creator is locked). Expect very good, not perfect, consistency.</span></li>
          <li><span class="dot"></span><span class="t">Voices are described (“deep calm male voice”), not locked, so they can differ between videos.</span></li>
          <li><span class="dot"></span><span class="t">The API is billed separately from a Higgsfield plan. The plan’s “unlimited” windows don’t apply to it.</span></li>
          <li><span class="dot"></span><span class="t">The app can’t open TikTok/Instagram links; to copy a video, upload the MP4 (2–15 seconds).</span></li></ul></div>
        <div class="card"><h2>Sources</h2><ul class="todo">${P.sources.map(s => `<li><a href="${esc(s[1])}" target="_blank" rel="noopener">${esc(s[0])}</a></li>`).join('')}</ul></div>`;
    }
  };
})(window.CS);
