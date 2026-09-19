/* Settings: plan + credit budget, credit log, backup / restore. */
(function (CS) {
  const esc = CS.esc;
  const PLANS = ['Not subscribed yet', 'Starter (~200-270 credits/mo)', 'Plus (~1000-1200 credits/mo)', 'Ultra (~3000+ credits/mo)', 'Custom'];

  function apiSpendCard() {
    const jobs = CS.S.jobs.filter(j => j.run && j.run.spend.length), E = window.CSFactory, u = n => '$' + n.toFixed(n < 0.1 ? 3 : 2);
    const now = new Date(), day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const b = CS.produce.budget;
    return `<div class="card"><h2>API spend</h2>
      <div class="grid2"><div><b>${u(b.spentSince(day))}</b><div class="muted">today</div></div><div><b>${u(b.spentSince(month))}</b><div class="muted">this month</div></div><div><b>${u(b.spentSince(0))}</b><div class="muted">all time (as recorded here)</div></div></div>
      <p class="muted">Recorded from Higgsfield’s exact prices. Failed, moderated and canceled jobs aren’t charged. Your real balance is in the Higgsfield Console.</p>
      ${jobs.length ? `<table><tr><th>Production</th><th>Charged</th><th>Pending</th></tr>${jobs.slice(0, 20).map(j => { const t = E.totals(j); return `<tr><td><a href="#/produce/${j.id}">${esc(j.title)}</a></td><td>${u(t.charged)}</td><td>${t.reserved ? u(t.reserved) : '—'}</td></tr>`; }).join('')}</table>` : ''}</div>`;
  }

  CS.views.settings = {
    render() {
      const s = CS.S.settings, log = s.creditLog, ig = CS.imagegen.settings(), hg = s.higgs;
      return `
        <div class="page-head"><div><h1>Settings</h1></div></div>
        <div class="card"><h2>Make videos inside the app (Higgsfield API)</h2>
          <p class="muted">Lets the app generate, preview and save videos and pictures itself. It uses Higgsfield’s <b>API</b>, a separate prepaid dollar balance (from $5) — your $59 plan credits can’t be used for this. Every step is priced first and needs your OK; nothing is charged for failed jobs.</p>
          <div class="grid2">
            <div class="field"><label>How the app talks to Higgsfield</label><select data-bind="settings.hmode">
              <option value="off" ${hg.mode === 'off' ? 'selected' : ''}>Off — I’ll use Claude + Higgsfield (copy prompts)</option>
              <option value="proxy" ${hg.mode === 'proxy' ? 'selected' : ''}>Through my proxy (recommended — key stays off this device)</option>
              <option value="direct" ${hg.mode === 'direct' ? 'selected' : ''}>Directly from this browser (key stored on this device)</option></select></div>
          </div>
          ${hg.mode === 'direct' ? `<div class="grid2">
            <div class="field"><label>API key ID</label><input type="text" id="hg_id" value="${esc(hg.keyId)}" autocomplete="off"></div>
            <div class="field"><label>API key secret</label><input type="password" id="hg_secret" value="${esc(hg.keySecret)}" autocomplete="off"></div></div>
            <label class="row" style="gap:8px;margin:6px 0;"><input type="checkbox" id="hg_ack" ${hg.ack ? 'checked' : ''}><span class="muted">I understand Higgsfield advises against using API keys in a browser: anyone who can open this device’s browser data could spend my balance. I’ll keep only a small balance (top-up $5–$20, auto top-up off) and can rotate the key any time.</span></label>` : ''}
          ${hg.mode === 'proxy' ? `<div class="grid2">
            <div class="field"><label>Proxy address</label><input type="text" id="hg_proxy" value="${esc(hg.proxyUrl)}" placeholder="https://studio-proxy.yourname.workers.dev"></div>
            <div class="field"><label>Proxy password (studio token)</label><input type="password" id="hg_token" value="${esc(hg.proxyToken)}" autocomplete="off"></div></div>
            <p class="muted">Setup steps are in <b>worker/README.md</b> in the repository (a free Cloudflare Worker that holds the key for you).</p>` : ''}
          ${hg.mode !== 'off' ? `<h3 style="margin-top:8px;">Spending safety</h3><div class="grid2">
            <div class="field"><label>Max per video ($)</label><input type="number" id="hg_cap_job" min="0" step="0.5" value="${hg.caps.perJob}"></div>
            <div class="field"><label>Max per day ($)</label><input type="number" id="hg_cap_day" min="0" step="1" value="${hg.caps.daily}"></div>
            <div class="field"><label>Max per month ($)</label><input type="number" id="hg_cap_month" min="0" step="5" value="${hg.caps.monthly}"></div>
            <div class="field"><label>Go ahead without asking under ($)</label><input type="number" id="hg_auto" min="0" step="0.05" value="${hg.autoBelowUsd}"></div>
            <div class="field"><label>Generations at once</label><input type="number" id="hg_par" min="1" max="6" value="${hg.maxParallel}"></div></div>
            <label class="row" style="gap:8px;margin:6px 0;"><input type="checkbox" id="hg_disc" ${hg.disclose ? 'checked' : ''}><span class="muted">Add “(AI-generated)” to captions in the post kit</span></label>
            <div class="row"><button class="btn" data-action="hgSave">Save</button><button class="btn secondary" data-action="hgTest">Test connection (free)</button></div><div id="hg_test" class="muted" style="margin-top:8px;"></div>` : ''}
        </div>
        ${hg.mode !== 'off' ? apiSpendCard() : ''}
        <div class="card"><h2>Higgsfield plan &amp; credit budget</h2>
          <div class="grid2">
            <div class="field"><label>Plan</label><select id="set_plan">${PLANS.map(p => `<option ${s.plan === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
            <div class="field"><label>Monthly credit allowance</label><input type="number" id="set_allowance" min="0" value="${+s.allowance || 0}"></div>
            <div class="field"><label>Monthly $ budget</label><input type="number" id="set_budget" min="0" value="${+s.budget || 0}"></div>
          </div>
          <button class="btn" data-action="setSave">Save</button></div>
        <div class="card"><h2>Credit usage log</h2>
          <p class="muted">Marking a job done with a credit amount logs it here automatically. You can also add a manual entry.</p>
          <div class="row"><input type="number" id="manual_credit" min="0" placeholder="credits" style="max-width:120px;"><input type="text" id="manual_note" placeholder="note" style="flex:1;min-width:140px;"><button class="btn secondary" data-action="setLog">Log</button></div>
          <div style="margin-top:10px;">${log.length ? `<table><tr><th>Date</th><th>Credits</th><th>Note</th><th></th></tr>${log.slice(0, 50).map((l, i) => `<tr><td>${esc(l.date)}</td><td>${+l.amount || 0}</td><td>${esc(l.note)}</td><td>${l.jobId ? '' : `<button class="btn small ghost" data-action="setLogDel" data-i="${i}">✕</button>`}</td></tr>`).join('')}</table>` : '<div class="empty">No usage logged yet.</div>'}</div>
        </div>
        <div class="card"><h2>Picture generation</h2>
          <p class="muted">Used by “Generate here” for Influencer Photos. Videos, and pictures that must keep a creator’s locked face, still go through Higgsfield in your Claude chat.</p>
          <div class="grid2">
            <div class="field"><label>Provider</label><select data-bind="settings.provider"><option value="free" ${ig.provider === 'free' ? 'selected' : ''}>Free service (no account) — slower, no consistent face</option><option value="custom" ${ig.provider === 'custom' ? 'selected' : ''}>My own key (OpenAI-compatible)</option></select></div>
            ${ig.provider === 'custom' ? `<div class="field"><label>API base URL</label><input type="text" id="ig_base" value="${esc(ig.baseUrl)}"></div>
            <div class="field"><label>Model</label><input type="text" id="ig_model" value="${esc(ig.model)}" placeholder="gpt-image-1"></div>
            <div class="field"><label>API key</label><input type="password" id="ig_key" value="${esc(ig.apiKey)}" autocomplete="off" placeholder="sk-…"></div>` : ''}
          </div>
          ${ig.provider === 'custom' ? '<p class="muted">Your provider bills you for each picture. The key is stored only in this browser and is left out of backup exports — use a key with a spending limit.</p><button class="btn" data-action="igSave">Save</button>' : ''}
        </div>
        <div class="card"><h2>Backup</h2>
          <p class="muted">Everything lives in this browser’s local storage only. Export regularly, and before clearing browser data.</p>
          <div class="row">
            <button class="btn secondary" data-action="exportData">Export backup (.json)</button>
            <button class="btn secondary" data-action="importPick">Import backup</button>
            <input type="file" id="importFile" accept=".json" style="display:none;" data-bind="settings.import">
            <button class="btn danger" data-action="resetAll">Erase all data</button>
          </div></div>`;
    }
  };

  CS.actions.setSave = () => {
    const s = CS.S.settings;
    s.plan = document.getElementById('set_plan').value;
    s.allowance = Math.max(0, parseFloat(document.getElementById('set_allowance').value) || 0);
    s.budget = Math.max(0, parseFloat(document.getElementById('set_budget').value) || 0);
    CS.save(); CS.ui.toast('Settings saved.');
  };
  CS.actions.setLog = () => {
    const amt = parseFloat(document.getElementById('manual_credit').value) || 0;
    if (!amt) { CS.ui.toast('Enter a credit amount.'); return; }
    CS.S.settings.creditLog.unshift({ date: CS.today(), amount: amt, note: document.getElementById('manual_note').value.trim() || 'manual entry' });
    CS.save();
  };
  CS.actions.igSave = () => {
    const ig = CS.S.settings.imagegen;
    ig.baseUrl = document.getElementById('ig_base').value.trim() || 'https://api.openai.com/v1';
    ig.model = document.getElementById('ig_model').value.trim() || 'gpt-image-1';
    ig.apiKey = document.getElementById('ig_key').value.trim();
    CS.save(); CS.ui.toast('Picture settings saved.');
  };
  CS.actions.hgSave = () => {
    const hg = CS.S.settings.higgs, v = id => { const el = document.getElementById(id); return el ? el.value.trim() : null; }, n = (id, def) => { const x = parseFloat(v(id)); return isFinite(x) && x >= 0 ? x : def; };
    if (hg.mode === 'direct') { hg.keyId = v('hg_id') || ''; hg.keySecret = v('hg_secret') || ''; hg.ack = !!document.getElementById('hg_ack').checked; }
    if (hg.mode === 'proxy') { hg.proxyUrl = (v('hg_proxy') || '').replace(/\/+$/, ''); hg.proxyToken = v('hg_token') || ''; }
    hg.caps = { perJob: n('hg_cap_job', hg.caps.perJob), daily: n('hg_cap_day', hg.caps.daily), monthly: n('hg_cap_month', hg.caps.monthly) };
    hg.autoBelowUsd = n('hg_auto', hg.autoBelowUsd); hg.maxParallel = Math.max(1, Math.min(6, Math.round(n('hg_par', hg.maxParallel)))); hg.disclose = !!document.getElementById('hg_disc').checked;
    CS.save(); CS.ui.toast('Saved.');
  };
  CS.actions.hgTest = async () => {
    CS.actions.hgSave(); const out = document.getElementById('hg_test'); if (out) out.textContent = 'Checking…';
    if (!CS.produce.ready()) { const o = document.getElementById('hg_test'); if (o) o.textContent = CS.S.settings.higgs.mode === 'direct' ? 'Add the key ID and secret, and tick the box.' : 'Add the proxy address.'; return; }
    const r = await CS.produce.test(); const o = document.getElementById('hg_test'); if (o) { o.textContent = r.msg; o.style.color = r.ok ? 'var(--green)' : '#f0a3a0'; }
  };
  CS.actions.setLogDel = d => { CS.S.settings.creditLog.splice(+d.i, 1); CS.save(); };

  CS.actions.exportData = () => {
    const copy = CS.clone(CS.S); copy.settings.imagegen.apiKey = ''; copy.settings.higgs.keySecret = ''; copy.settings.higgs.proxyToken = ''; // never write keys into a file you might share
    const json = JSON.stringify(copy, null, 2), a = document.createElement('a');
    try { a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); }
    catch (e) { a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json); }
    a.download = 'creator-studio-backup-' + CS.today() + '.json'; a.click();
  };
  CS.actions.importPick = () => document.getElementById('importFile').click();
  CS.binds.settings = (k, el) => {
    if (k === 'provider') { CS.S.settings.imagegen.provider = el.value; CS.save(); return; }
    if (k === 'hmode') { CS.S.settings.higgs.mode = el.value; CS.save(); return; }
    if (k !== 'import') return;
    const file = el.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || !Array.isArray(data.creators)) throw new Error('not a Creator Studio backup');
        CS.ui.confirm('Importing replaces everything currently in this browser. Continue?', () => { const key = CS.S.settings.imagegen.apiKey, hs = CS.S.settings.higgs; CS.S = CS.normalize(data); if (!CS.S.settings.imagegen.apiKey) CS.S.settings.imagegen.apiKey = key; ['keyId', 'keySecret', 'proxyToken', 'proxyUrl', 'ack'].forEach(k => { if (!CS.S.settings.higgs[k]) CS.S.settings.higgs[k] = hs[k]; }); CS.save(); CS.ui.toast('Backup imported.'); }, { yes: 'Import', danger: false, title: 'Import backup' });
      } catch (e) { CS.ui.toast('That file isn’t a valid backup.'); }
    };
    r.readAsText(file);
  };
  CS.actions.resetAll = () => CS.ui.confirm('This erases all creators, library items, jobs and settings in this browser. Export a backup first. Pictures and videos in Files are not erased — remove those in Files.', () => { CS.S = CS.blankState(); CS.save(); CS.ui.toast('All data erased.'); }, { yes: 'Erase everything', title: 'Erase all data' });
})(window.CS);
