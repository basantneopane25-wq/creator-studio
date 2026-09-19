/* Factory: runs a production plan against Higgsfield.  Pure logic, all side effects come in through `deps`
   (client, storage, ledger), so it is tested end-to-end against the mock server (tools/test-factory.js).

   Guarantees:
   - No spend without a fresh exact estimate, a passing budget check and (above the auto-approve amount) a click.
   - request_id is persisted the instant a job is accepted; a page reload resumes watching instead of paying again.
   - An unclear submit outcome becomes "uncertain": it is NEVER retried automatically.
   - Results are downloaded the moment they finish (Higgsfield deletes them after ~7 days).
   - The spend ledger is settled per job: reserved -> charged (completed) or refunded (failed / nsfw / canceled).

   job.run = { state, plan:{steps}, rt:{refUrls,stillUrl,stillAt,refVideoUrl,audioUrl}, spend:[], events:[] }
   step.status: planned | estimating | confirm | running | review | done | failed | skipped
   item.status: idle | submitting | queued | in_progress | completed | failed | nsfw | canceled | uncertain | stalled */
(function (root) {
  const E = {};
  const DAY = 86400000, URL_MAX_AGE = 6 * DAY; // outputs/uploads live >=7 days; refresh a bit earlier
  const isActive = s => ['submitting', 'queued', 'in_progress'].includes(s);
  const busy = new Set(); // in-memory guards against double clicks

  const log = (job, deps, msg) => { const r = job.run; r.events.push({ t: deps.now(), msg }); if (r.events.length > 60) r.events.splice(0, r.events.length - 60); };
  const save = deps => { deps.persist(); if (deps.onChange) deps.onChange(); };
  const stepOf = (job, id) => job.run.plan.steps.find(s => s.id === id);
  const itemsOf = s => s.items || (s.items = []);
  const uid = (job, deps) => 'sp' + deps.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- spending caps: per production, per day, per month ---------- */
  // getJobs() -> all jobs (each may have run.spend);  getCaps() -> { perJob, daily, monthly } in USD (0 = no cap)
  E.makeBudget = function (getJobs, getCaps, nowFn) {
    const counted = x => x.status === 'charged' || x.status === 'reserved';
    const sum = (list, from) => list.reduce((a, x) => a + (counted(x) && x.at >= from ? x.usd : 0), 0);
    return {
      spentSince(from) { let t = 0; getJobs().forEach(j => { if (j.run) t += sum(j.run.spend, from); }); return t; },
      check(job, usd) {
        const caps = getCaps(), now = new Date(nowFn());
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const f = n => '$' + n.toFixed(2);
        if (caps.perJob > 0) { const s = job && job.run ? sum(job.run.spend, 0) : 0; if (s + usd > caps.perJob + 1e-9) return { ok: false, reason: `This production would reach ${f(s + usd)} — over your ${f(caps.perJob)} per-video cap. Raise the cap in Settings if that’s intended.` }; }
        if (caps.daily > 0) { const s = this.spentSince(day); if (s + usd > caps.daily + 1e-9) return { ok: false, reason: `Today’s spend would reach ${f(s + usd)} — over your ${f(caps.daily)} daily cap.` }; }
        if (caps.monthly > 0) { const s = this.spentSince(month); if (s + usd > caps.monthly + 1e-9) return { ok: false, reason: `This month’s spend would reach ${f(s + usd)} — over your ${f(caps.monthly)} monthly cap.` }; }
        return { ok: true };
      }
    };
  };

  E.init = function (job, plan, deps) {
    job.run = { v: 1, lane: 'api', state: 'planned', createdAt: deps.now(), plan: { steps: plan.steps.map(s => Object.assign({}, s)) }, rt: { refUrls: [], stillUrl: '', stillAt: 0, refVideoUrl: '', audioUrl: '' }, spend: [], events: [] };
    log(job, deps, 'Production created');
    return job.run;
  };

  E.totals = function (job) {
    const t = { charged: 0, reserved: 0, refunded: 0 };
    ((job.run && job.run.spend) || []).forEach(x => { t[x.status] = (t[x.status] || 0) + x.usd; });
    return t;
  };

  /* ---------- free preparation: upload reference photos / audio / video ---------- */
  E.prepare = async function (job, deps) {
    const rt = job.run.rt, steps = job.run.plan.steps;
    const uploadOne = async (step, fn) => {
      step.status = 'running'; step.error = ''; save(deps);
      try { await fn(); step.status = 'done'; }
      catch (e) { step.status = 'failed'; step.error = e.message || String(e); step.errorKind = e.kind; log(job, deps, `${step.label} failed: ${step.error}`); }
      save(deps); return step.status === 'done';
    };
    const refs = steps.find(s => s.id === 'refs');
    if (refs && refs.status !== 'done') {
      const ok = await uploadOne(refs, async () => {
        const srcs = await deps.refSources(job); const urls = [];
        for (const r of srcs) { const blob = deps.dataUrlToBlob(r.src); urls.push(await deps.client.upload(blob, blob.type)); }
        rt.refUrls = urls; rt.refKeys = srcs.map(r => r.key);
      });
      if (!ok) return false;
    }
    const aud = steps.find(s => s.type === 'audio');
    if (aud && aud.status !== 'done') { if (!await uploadOne(aud, async () => { const b = await deps.getAudio(job, aud); rt.audioUrl = await deps.client.upload(b, 'audio/wav'); })) return false; }
    const vid = steps.find(s => s.type === 'upload-video');
    if (vid && vid.status !== 'done') { if (!await uploadOne(vid, async () => { const b = await deps.getRefVideo(job); rt.refVideoUrl = await deps.client.upload(b, 'video/mp4'); })) return false; }
    return true;
  };

  /* ---------- pricing & confirmation ---------- */
  E.bodyFor = (job, step, deps) => deps.R.buildBody(step, job.run.rt);

  // A still URL from Higgsfield lives ~7 days; if it is old, upload the saved copy again so a stale link never breaks the next step.
  E.ensureStill = async function (job, deps) {
    const rt = job.run.rt;
    if (!rt.stillUrl) return;
    if (deps.now() - (rt.stillAt || 0) < URL_MAX_AGE) return;
    const key = rt.stillTemp; if (!key) return;
    const blob = await deps.temp.get(key); if (!blob) return;
    rt.stillUrl = await deps.client.upload(blob, blob.type || 'image/png'); rt.stillAt = deps.now();
    log(job, deps, 'Refreshed the starting frame link'); save(deps);
  };

  E.estimate = async function (job, stepId, deps) {
    const step = stepOf(job, stepId); const lock = job.id + stepId;
    if (!step || busy.has(lock)) return;
    busy.add(lock);
    try {
      step.status = 'estimating'; step.error = ''; save(deps);
      if (step.needs === 'still') await E.ensureStill(job, deps);
      if (step.needs === 'still' && !job.run.rt.stillUrl) throw Object.assign(new Error('Pick a starting frame first.'), { kind: 'blocked' });
      const n = step.n || 1;
      const est = await deps.client.estimate(deps.R.MODELS[step.model].id, E.bodyFor(job, step, deps));
      step.estimate = { usd: est.usd * n, credits: est.credits != null ? est.credits * n : null, each: est.usd, at: deps.now() };
      step.status = 'confirm'; log(job, deps, `${step.label}: exact price $${step.estimate.usd.toFixed(3)}`);
    } catch (e) {
      step.status = e.kind === 'blocked' ? 'planned' : 'failed'; step.error = e.message || String(e); step.errorKind = e.kind;
      log(job, deps, `${step.label}: ${step.error}`);
    } finally { busy.delete(lock); save(deps); }
    // small spends inside the auto-approve amount continue without a click (caps still apply in confirm)
    if (step.status === 'confirm' && deps.settings.autoBelowUsd > 0 && step.estimate.usd <= deps.settings.autoBelowUsd) return E.confirm(job, stepId, deps, { auto: true });
  };

  /* ---------- spending ---------- */
  E.confirm = async function (job, stepId, deps, opt) {
    const step = stepOf(job, stepId); const lock = job.id + stepId + 'c';
    if (!step || step.status !== 'confirm' || busy.has(lock)) return { ok: false, reason: 'not ready' };
    busy.add(lock);
    try {
      const usd = step.estimate.usd;
      const chk = deps.budget.check(job, usd);
      if (!chk.ok) { step.error = chk.reason; step.blocked = true; save(deps); return { ok: false, reason: chk.reason }; }
      step.blocked = false; step.error = ''; step.status = 'running';
      const n = step.n || 1; step.items = Array.from({ length: n }, (_, i) => ({ id: 'c' + (i + 1), status: 'idle', usd: step.estimate.each }));
      log(job, deps, `${step.label}: confirmed $${usd.toFixed(3)}${opt && opt.auto ? ' (auto)' : ''}`); save(deps);
    } finally { busy.delete(lock); }
    await E.runItems(job, step, deps);
    return { ok: true };
  };

  E.runItems = async function (job, step, deps) {
    const max = Math.max(1, deps.maxParallel || 3), pending = itemsOf(step).filter(i => i.status === 'idle');
    let idx = 0;
    const worker = async () => { while (idx < pending.length) { const it = pending[idx++]; await E.submitItem(job, step, it, deps); } };
    await Promise.all(Array.from({ length: Math.min(max, pending.length) }, worker));
    await Promise.all(itemsOf(step).filter(i => isActive(i.status)).map(i => E.watchItem(job, step, i, deps)));
    E.settleStep(job, step, deps);
  };

  E.submitItem = async function (job, step, it, deps) {
    const entry = { id: uid(job, deps), at: deps.now(), stepId: step.id, itemId: it.id, usd: it.usd, status: 'reserved' };
    it.status = 'submitting'; it.error = ''; job.run.spend.push(entry); it.spendId = entry.id; save(deps); // persisted BEFORE the network call
    try {
      const body = E.bodyFor(job, step, deps);
      const r = await deps.client.submit(deps.R.MODELS[step.model].id, body);
      it.requestId = r.requestId; it.status = r.status === 'in_progress' ? 'in_progress' : 'queued'; it.submittedAt = deps.now();
      log(job, deps, `${step.label} #${it.id} accepted (${r.requestId.slice(0, 8)}…)`); save(deps);
    } catch (e) {
      if (e.ambiguous) { it.status = 'uncertain'; it.error = 'Higgsfield may or may not have accepted this. Check Higgsfield Console → Requests before trying again, so you don’t pay twice.'; log(job, deps, `${step.label} #${it.id}: outcome unclear (${e.kind})`); }
      else { it.status = 'failed'; it.error = e.message || String(e); entry.status = 'refunded'; log(job, deps, `${step.label} #${it.id} rejected: ${it.error}`); }
      if (e.ambiguous) entry.status = 'reserved'; // keep counting it until the user resolves it
      save(deps);
    }
  };

  E.watchItem = async function (job, step, it, deps) {
    const entry = job.run.spend.find(x => x.id === it.spendId);
    try {
      const res = await deps.client.poll(it.requestId, { deadlineMs: step.model && deps.R.MODELS[step.model].kind === 'image' ? 6 * 60000 : 20 * 60000, onUpdate: s => { if (['queued', 'in_progress'].includes(s.status) && it.status !== s.status) { it.status = s.status; save(deps); } } });
      if (res.status === 'completed') {
        const url = res.video || res.images[0] || null;
        if (!url) throw Object.assign(new Error('Higgsfield finished but returned no file.'), { kind: 'unexpected' });
        it.url = url; it.completedAt = deps.now(); it.status = 'completed'; if (entry) entry.status = 'charged';
        // download NOW: outputs are deleted after ~7 days
        try { const blob = await deps.client.download(url); it.tempKey = `tmp:${job.id}:${step.id}:${it.id}:${it.requestId}`; await deps.temp.put(it.tempKey, blob); it.size = blob.size; it.type = blob.type; }
        catch (e) { it.downloadError = e.message || 'Download failed'; log(job, deps, `${step.label} #${it.id} finished but could not be saved: ${it.downloadError}`); }
      } else {
        it.status = res.status; if (entry) entry.status = 'refunded';
        it.error = res.status === 'nsfw' ? 'Blocked by Higgsfield content moderation. Nothing was charged — adjust the prompt or photos.' : res.status === 'canceled' ? 'Canceled.' : 'Higgsfield could not make this one. Nothing was charged.';
      }
    } catch (e) {
      if (e.kind === 'timeout') { it.status = 'stalled'; it.error = 'Still running on Higgsfield. It may finish — check again in a few minutes.'; }
      else { it.status = 'stalled'; it.error = (e.message || String(e)) + ' (the job may still be running — use “Check again”)'; }
    }
    log(job, deps, `${step.label} #${it.id}: ${it.status}`); save(deps);
  };

  E.settleStep = function (job, step, deps) {
    const items = itemsOf(step);
    if (items.some(i => isActive(i.status) || i.status === 'idle')) { step.status = 'running'; }
    else if (items.some(i => i.status === 'completed')) step.status = 'review';
    else step.status = 'failed', step.error = step.error || (items.find(i => i.error) || {}).error || 'Nothing was produced.';
    save(deps);
  };

  // Look at an item again (after a stall or an unclear outcome) — never submits anything new.
  E.check = async function (job, stepId, itemId, deps) {
    const step = stepOf(job, stepId), it = itemsOf(step).find(i => i.id === itemId);
    if (!it || !it.requestId) return;
    it.status = 'queued'; it.error = ''; save(deps);
    await E.watchItem(job, step, it, deps); E.settleStep(job, step, deps);
  };

  // The user has looked in Higgsfield and confirms it was NOT accepted -> allow a fresh attempt (may cost again).
  E.retryItem = async function (job, stepId, itemId, deps) {
    const step = stepOf(job, stepId), it = itemsOf(step).find(i => i.id === itemId);
    if (!it || !['failed', 'nsfw', 'canceled', 'uncertain', 'stalled'].includes(it.status)) return;
    const old = job.run.spend.find(x => x.id === it.spendId);
    if (old && old.status === 'reserved') old.status = 'refunded'; // the user has resolved it
    if (it.status === 'stalled' && it.requestId) return E.check(job, stepId, itemId, deps); // still known to Higgsfield: just look again
    const chk = deps.budget.check(job, it.usd || 0); if (!chk.ok) { it.error = chk.reason; save(deps); return; }
    Object.assign(it, { status: 'idle', error: '', requestId: '', url: '', tempKey: '' });
    step.status = 'running'; save(deps);
    await E.runItems(job, step, deps);
  };

  E.cancelItem = async function (job, stepId, itemId, deps) {
    const step = stepOf(job, stepId), it = itemsOf(step).find(i => i.id === itemId);
    if (!it || !it.requestId || !isActive(it.status)) return false;
    const ok = await deps.client.cancel(it.requestId);
    if (ok) { it.status = 'canceled'; it.error = 'Canceled.'; const e = job.run.spend.find(x => x.id === it.spendId); if (e) e.status = 'refunded'; E.settleStep(job, step, deps); }
    return ok;
  };

  /* ---------- decisions ---------- */
  E.pick = async function (job, stepId, itemId, deps) {
    const step = stepOf(job, stepId), it = itemsOf(step).find(i => i.id === itemId);
    if (!it || it.status !== 'completed') return false;
    for (const other of itemsOf(step)) { // the candidates you did not choose are not kept
      other.picked = other === it;
      if (other !== it && other.tempKey) { await deps.temp.del(other.tempKey).catch(() => {}); other.tempKey = ''; other.dropped = true; }
    }
    job.run.rt.stillUrl = it.url; job.run.rt.stillAt = it.completedAt || deps.now(); job.run.rt.stillTemp = it.tempKey || '';
    step.status = 'done'; log(job, deps, 'Starting frame chosen'); save(deps); return true;
  };

  // Approve a finished video -> save it to Files with its post kit next to it.
  E.approve = async function (job, stepId, itemId, deps) {
    const step = stepOf(job, stepId), it = itemsOf(step).find(i => i.id === itemId);
    const lock = job.id + itemId + 'a'; if (!it || it.status !== 'completed' || busy.has(lock)) return null;
    busy.add(lock);
    try {
      if (!it.tempKey) throw new Error('The file was not saved yet — use “Retry download”.');
      const blob = await deps.temp.get(it.tempKey); if (!blob) throw new Error('The saved copy is missing.');
      const rec = await deps.promote(job, blob, { step, item: it });
      it.mediaId = rec.id; it.approved = true; step.status = 'done'; log(job, deps, `${step.label} approved → Files`);
      await deps.temp.del(it.tempKey); it.tempKey = '';
      save(deps); return rec;
    } catch (e) { it.error = e.message || String(e); save(deps); return null; } finally { busy.delete(lock); }
  };

  // Photos: keep any number of the candidates (each is saved to Files with a caption kit), drop the rest.
  E.keep = async function (job, stepId, itemId, deps) {
    const step = stepOf(job, stepId), it = itemsOf(step).find(i => i.id === itemId);
    const lock = job.id + itemId + 'k'; if (!it || it.status !== 'completed' || it.approved || busy.has(lock)) return null;
    busy.add(lock);
    try {
      const blob = it.tempKey ? await deps.temp.get(it.tempKey) : null; if (!blob) throw new Error('The picture was not saved yet — use “Retry download”.');
      const rec = await deps.promote(job, blob, { step, item: it });
      it.mediaId = rec.id; it.approved = true; await deps.temp.del(it.tempKey); it.tempKey = '';
      E.finishIfResolved(job, step, deps); save(deps); return rec;
    } catch (e) { it.error = e.message || String(e); save(deps); return null; } finally { busy.delete(lock); }
  };
  E.dropItem = async function (job, stepId, itemId, deps) {
    const step = stepOf(job, stepId), it = itemsOf(step).find(i => i.id === itemId); if (!it || it.approved) return;
    if (it.tempKey) await deps.temp.del(it.tempKey).catch(() => {});
    it.tempKey = ''; it.dropped = true; E.finishIfResolved(job, step, deps); save(deps);
  };
  E.finishIfResolved = function (job, step, deps) {
    if (step.gate === 'keep' && itemsOf(step).every(i => i.approved || i.dropped || !['completed'].includes(i.status))) { step.status = 'done'; log(job, deps, 'Photos finished'); }
  };

  // The user did not like it: forget it and go back to "ready" (a new try needs a new estimate + confirmation).
  E.discard = async function (job, stepId, deps) {
    const step = stepOf(job, stepId);
    for (const i of itemsOf(step)) if (i.tempKey && !i.approved) { await deps.temp.del(i.tempKey).catch(() => {}); }
    step.items = []; step.estimate = null; step.status = 'planned'; step.error = '';
    if (step.id === 'still') { const rt = job.run.rt; rt.stillUrl = ''; rt.stillTemp = ''; }
    save(deps);
  };

  E.retryDownload = async function (job, stepId, itemId, deps) {
    const step = stepOf(job, stepId), it = itemsOf(step).find(i => i.id === itemId);
    if (!it || !it.url) return false;
    try { const blob = await deps.client.download(it.url); it.tempKey = `tmp:${job.id}:${step.id}:${it.id}:${it.requestId}`; await deps.temp.put(it.tempKey, blob); it.downloadError = ''; save(deps); return true; }
    catch (e) { it.downloadError = e.message || 'Download failed'; save(deps); return false; }
  };

  // Everything a production stored temporarily (previews, the chosen frame, uploaded audio/video) — used when it is deleted.
  E.tempKeys = job => {
    const keys = [`in:${job.id}:audio`, `in:${job.id}:video`];
    if (job.run) { if (job.run.rt.stillTemp) keys.push(job.run.rt.stillTemp); job.run.plan.steps.forEach(s => (s.items || []).forEach(i => { if (i.tempKey) keys.push(i.tempKey); })); }
    return Array.from(new Set(keys));
  };

  /* ---------- after a page reload ---------- */
  E.resume = async function (job, deps) {
    if (!job.run) return;
    const work = [];
    job.run.plan.steps.forEach(step => itemsOf(step).forEach(it => {
      if (it.status === 'submitting') { it.status = 'uncertain'; it.error = 'The page closed while this was being sent. Check Higgsfield Console → Requests before trying again.'; }
      else if (isActive(it.status) && it.requestId) work.push(E.watchItem(job, step, it, deps).then(() => E.settleStep(job, step, deps)));
    }));
    save(deps); await Promise.all(work);
  };

  // A production is finished once its deliverable (video, or kept photos) has been approved into Files.
  E.isFinished = job => !!job.run && job.run.plan.steps.some(s => (s.type === 'video' || s.gate === 'keep') && s.status === 'done');

  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.CSFactory = E;
})(typeof window !== 'undefined' ? window : globalThis);
