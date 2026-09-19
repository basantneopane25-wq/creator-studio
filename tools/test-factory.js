/* End-to-end tests for js/factory.js against the mock Higgsfield server.   node tools/test-factory.js */
const assert = require('assert');
const { start, png } = require('./mock-higgsfield');
const { createClient } = require('../js/higgs.js');
const R = require('../js/recipes.js');
const K = require('../js/postkit.js');
const E = require('../js/factory.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); } }

const pngBuf = png(8, 8, [10, 120, 200]);
const dataUrl = 'data:image/png;base64,' + pngBuf.toString('base64');
const creator = { name: 'Zayn', gender: 'male', ethnicity: 'South Asian', bodyType: 'Lean athletic', age: '20s-30s', profession: 'car gadget reviewer', niche: 'car tech', voiceName: 'Preset: Deep calm male', faceRefs: [dataUrl, dataUrl, dataUrl], id: 'cr1', folder: 'Zayn' };
const ctx = (over) => Object.assign({ creator, brand: { name: 'GripMount' }, wardrobe: [], background: null, accessories: [], style: 'Recommended: selfie' }, over || {});
const base = { concept: 'stopped my phone flying off the dash', product: 'GripMount holder', cta: 'Link in bio', duration: '15', aspect: '4:5', count: '2', audioMode: 'new', notes: '' };

let jobSeq = 0;
function world(mock, over) {
  const w = { saved: [], promoted: [], temp: new Map(), persists: 0, jobs: [], caps: { perJob: 0, daily: 0, monthly: 0 } };
  const client = createClient({ mode: 'direct', baseUrl: mock.url, keyId: 'test', keySecret: 'secret', pollMinMs: 10, pollMaxMs: 30 });
  w.deps = Object.assign({
    client, R, kit: K, now: () => Date.now(), persist() { w.persists++; }, onChange() {}, settings: { autoBelowUsd: 0 }, maxParallel: 3,
    refSources: async () => [{ key: 'face0', src: dataUrl }, { key: 'face1', src: dataUrl }, { key: 'face2', src: dataUrl }],
    dataUrlToBlob: u => new Blob([Buffer.from(u.split(',')[1], 'base64')], { type: 'image/png' }),
    getAudio: async () => new Blob([Buffer.alloc(2000)], { type: 'audio/wav' }), getRefVideo: async () => new Blob([Buffer.alloc(3000)], { type: 'video/mp4' }),
    temp: { put: async (k, b) => { w.temp.set(k, b); }, get: async k => w.temp.get(k) || null, del: async k => { w.temp.delete(k); } },
    promote: async (job, blob, o) => { const rec = { id: 'm' + (w.promoted.length + 1), size: blob.size, step: o.step.id, kit: o.step.type === 'video' ? K.toText(K.build({ format: job.type, concept: job.draft.concept, creator }), {}) : '' }; w.promoted.push(rec); return rec; },
    budget: null
  }, over || {});
  w.deps.budget = E.makeBudget(() => w.jobs, () => w.caps, () => Date.now());
  w.job = (type, d, c, extra) => { const job = Object.assign({ id: 'j' + (++jobSeq), type, draft: d }, extra); const plan = R.plan(type, d, c || ctx()); assert.deepStrictEqual(plan.errors, [], 'plan errors: ' + plan.errors.join('|')); E.init(job, plan, w.deps); w.jobs.push(job); return job; };
  return w;
}
const step = (job, id) => job.run.plan.steps.find(s => s.id === id);
const items = (job, id) => step(job, id).items;
const drive = async (w, job, id, o) => { await E.estimate(job, id, w.deps); if (step(job, id).status === 'confirm') await E.confirm(job, id, w.deps); return step(job, id); };

(async () => {
  console.log('happy paths');
  await t('UGC ad: upload refs -> stills -> pick -> draft -> approve; ledger equals what Higgsfield charged', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock), b0 = mock.state.balance;
    const job = w.job('ugc', base);
    assert.strictEqual(await E.prepare(job, w.deps), true); assert.strictEqual(job.run.rt.refUrls.length, 3); assert.strictEqual(step(job, 'refs').status, 'done');
    // stills
    await E.estimate(job, 'still', w.deps); const s = step(job, 'still'); assert.strictEqual(s.status, 'confirm'); assert.ok(Math.abs(s.estimate.usd - 0.08) < 1e-6, '' + s.estimate.usd);
    assert.strictEqual(mock.state.submits, 0, 'spent before confirmation');
    await E.confirm(job, 'still', w.deps); assert.strictEqual(s.status, 'review'); assert.strictEqual(s.items.length, 2); assert.ok(s.items.every(i => i.status === 'completed' && i.tempKey && w.temp.has(i.tempKey)));
    assert.ok(await E.pick(job, 'still', 'c2', w.deps)); assert.match(job.run.rt.stillUrl, /\/cdn\//); assert.strictEqual(s.status, 'done');
    assert.strictEqual(w.temp.size, 1, 'unchosen candidate should not be kept'); assert.deepStrictEqual(E.tempKeys(job).filter(k => w.temp.has(k)).length, 1);
    // draft video
    await E.estimate(job, 'video', w.deps); const v = step(job, 'video'); assert.strictEqual(v.status, 'confirm'); assert.ok(Math.abs(v.estimate.usd - 0.63) < 1e-6);
    const sent = mock.state.requests; const before = Object.keys(sent).length;
    await E.confirm(job, 'video', w.deps); assert.strictEqual(v.status, 'review'); assert.strictEqual(Object.keys(sent).length, before + 1);
    const body = Object.values(sent).pop().body; assert.strictEqual(body.image_url, job.run.rt.stillUrl); assert.strictEqual(body.multi_prompt.length, 3); assert.strictEqual(body.duration, 15);
    const rec = await E.approve(job, 'video', 'c1', w.deps); assert.ok(rec); assert.ok(rec.kit.includes('POST KIT')); assert.strictEqual(v.status, 'done'); assert.ok(E.isFinished(job)); assert.strictEqual(items(job, 'video')[0].tempKey, '');
    // money: what the app says it spent == what the mock actually deducted
    const tot = E.totals(job); assert.ok(Math.abs(tot.charged - (b0 - mock.state.balance)) < 1e-6, `ledger ${tot.charged} vs balance ${b0 - mock.state.balance}`); assert.strictEqual(tot.reserved, 0);
    await mock.close();
  });
  await t('photo: candidates -> keep some, drop the rest -> step done', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); const job = w.job('photo', Object.assign({}, base, { concept: 'iced coffee on a terrace', count: '3' }));
    await E.prepare(job, w.deps); await drive(w, job, 'still'); const s = step(job, 'still'); assert.strictEqual(s.items.length, 3);
    assert.ok(await E.keep(job, 'still', 'c1', w.deps)); await E.dropItem(job, 'still', 'c2', w.deps); assert.strictEqual(s.status, 'review'); assert.ok(await E.keep(job, 'still', 'c3', w.deps));
    assert.strictEqual(s.status, 'done'); assert.strictEqual(w.promoted.length, 2); assert.strictEqual(w.temp.size, 0, 'temp files not cleaned');
    assert.strictEqual(await E.keep(job, 'still', 'c1', w.deps), null, 'kept twice');
    await mock.close();
  });
  await t('sing: audio is prepared + uploaded; Seedance draft gets photos + audio', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock);
    const job = w.job('sing', Object.assign({}, base, { audioMode: 'upload', audioFile: { name: 's.wav', secs: 12 }, concept: 'neon stage' }));
    assert.ok(await E.prepare(job, w.deps)); assert.match(job.run.rt.audioUrl, /\.wav$/);
    await drive(w, job, 'video'); const body = Object.values(mock.state.requests).pop().body;
    assert.deepStrictEqual(body.audio_urls, [job.run.rt.audioUrl]); assert.strictEqual(body.image_urls.length, 3); assert.strictEqual(body.resolution, '480p'); assert.strictEqual(body.duration, 12);
    await mock.close();
  });
  await t('copy a trend: reference video uploaded and sent as video_urls', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock);
    const job = w.job('copy', Object.assign({}, base, { audioMode: 'new', refVideo: { type: 'video/mp4', secs: 8, size: 3000 } }));
    assert.ok(await E.prepare(job, w.deps)); await drive(w, job, 'video'); const body = Object.values(mock.state.requests).pop().body;
    assert.deepStrictEqual(body.video_urls, [job.run.rt.refVideoUrl]); assert.strictEqual(body.generate_audio, true);
    await mock.close();
  });

  console.log('money safety');
  await t('spending caps block a step BEFORE anything is submitted', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); w.caps.perJob = 0.05; const job = w.job('ugc', base);
    await E.prepare(job, w.deps); await E.estimate(job, 'still', w.deps); const r = await E.confirm(job, 'still', w.deps);
    assert.strictEqual(r.ok, false); assert.match(r.reason, /per-video cap/); assert.strictEqual(step(job, 'still').status, 'confirm'); assert.strictEqual(mock.state.submits, 0);
    w.caps.perJob = 1; assert.ok((await E.confirm(job, 'still', w.deps)).ok); await mock.close();
  });
  await t('daily and monthly caps add up across productions', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); w.caps.daily = 0.12;
    const a = w.job('photo', Object.assign({}, base, { concept: 'a', count: '2' })); await E.prepare(a, w.deps); await drive(w, a, 'still'); // $0.08
    const b = w.job('photo', Object.assign({}, base, { concept: 'b', count: '2' })); await E.prepare(b, w.deps); await E.estimate(b, 'still', w.deps);
    const r = await E.confirm(b, 'still', w.deps); assert.strictEqual(r.ok, false); assert.match(r.reason, /daily cap/); await mock.close();
  });
  await t('auto-approve applies only under the threshold and still respects caps', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock, { settings: { autoBelowUsd: 0.1 } }); const job = w.job('photo', Object.assign({}, base, { count: '2' }));
    await E.prepare(job, w.deps); await E.estimate(job, 'still', w.deps); assert.strictEqual(step(job, 'still').status, 'review', 'should have auto-run'); // $0.08 <= $0.10
    const j2 = w.job('ugc', base); await E.prepare(j2, w.deps); assert.ok(await E.pick(j2, 'still', 'c1', w.deps) === false);
    j2.run.rt.stillUrl = 'https://x/y.png'; j2.run.rt.stillAt = Date.now(); await E.estimate(j2, 'video', w.deps); assert.strictEqual(step(j2, 'video').status, 'confirm', '$0.63 must wait for a click'); await mock.close();
  });
  await t('invalid settings are caught by the free estimate: nothing submitted, step fails with the reason', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); const job = w.job('ugc', base); await E.prepare(job, w.deps);
    step(job, 'still').params.aspect_ratio = '5:7'; await E.estimate(job, 'still', w.deps);
    assert.strictEqual(step(job, 'still').status, 'failed'); assert.match(step(job, 'still').error, /aspect_ratio/); assert.strictEqual(mock.state.submits, 0); await mock.close();
  });
  await t('LOST REPLY: item becomes "uncertain", is not resubmitted, keeps counting as reserved', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); const job = w.job('photo', Object.assign({}, base, { concept: 'x [[lost]]', count: '1' }));
    await E.prepare(job, w.deps); await drive(w, job, 'still'); const it = items(job, 'still')[0];
    assert.strictEqual(it.status, 'uncertain'); assert.strictEqual(mock.state.submits, 1); assert.strictEqual(E.totals(job).reserved > 0, true); assert.strictEqual(step(job, 'still').status, 'failed');
    // user checked Higgsfield and says "try again" -> only then a second submit
    job.run.plan.steps.find(s => s.id === 'still').prompt = 'a clean prompt'; await E.retryItem(job, 'still', 'c1', w.deps); assert.strictEqual(mock.state.submits, 2); assert.strictEqual(it.status, 'completed');
    await mock.close();
  });
  await t('nsfw / failed: nothing charged, ledger refunded, retry possible', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock), b0 = mock.state.balance; const job = w.job('photo', Object.assign({}, base, { concept: 'x [[nsfw]]', count: '1' }));
    await E.prepare(job, w.deps); await drive(w, job, 'still'); const it = items(job, 'still')[0];
    assert.strictEqual(it.status, 'nsfw'); assert.match(it.error, /moderation/); assert.strictEqual(E.totals(job).charged, 0); assert.strictEqual(E.totals(job).reserved, 0); assert.strictEqual(mock.state.balance, b0);
    await mock.close();
  });
  await t('submit rejected by Higgsfield (403 credits): item failed, reservation released', async () => {
    const mock = await start(0, { speed: 0.05, balance: 0.01 }), w = world(mock); const job = w.job('photo', Object.assign({}, base, { count: '1' }));
    await E.prepare(job, w.deps); await drive(w, job, 'still'); const it = items(job, 'still')[0]; assert.strictEqual(it.status, 'failed'); assert.match(it.error, /balance|credits/i); assert.strictEqual(E.totals(job).reserved, 0); await mock.close();
  });
  await t('double-clicking confirm does not double-submit', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); const job = w.job('photo', Object.assign({}, base, { count: '2' }));
    await E.prepare(job, w.deps); await E.estimate(job, 'still', w.deps);
    await Promise.all([E.confirm(job, 'still', w.deps), E.confirm(job, 'still', w.deps), E.confirm(job, 'still', w.deps)]); assert.strictEqual(mock.state.submits, 2); await mock.close();
  });

  console.log('reload, cancel, stale links, downloads');
  await t('page reload mid-generation: state survives JSON and watching resumes (no new submit)', async () => {
    const mock = await start(0, { speed: 1 }), w = world(mock); const job = w.job('photo', Object.assign({}, base, { count: '1' }));
    await E.prepare(job, w.deps); await E.estimate(job, 'still', w.deps);
    const running = E.confirm(job, 'still', w.deps); await new Promise(r => setTimeout(r, 150)); // accepted, still queued
    const snapshot = JSON.parse(JSON.stringify(job)); assert.ok(snapshot.run.plan.steps.find(s => s.id === 'still').items[0].requestId);
    const w2 = world(mock); w2.jobs.push(snapshot); const subs = mock.state.submits;
    await E.resume(snapshot, w2.deps); assert.strictEqual(mock.state.submits, subs); const it = snapshot.run.plan.steps.find(s => s.id === 'still').items[0]; assert.strictEqual(it.status, 'completed'); assert.ok(w2.temp.size === 1);
    await running; await mock.close();
  });
  await t('reload while a submit was in flight -> "uncertain", never re-sent', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); const job = w.job('photo', Object.assign({}, base, { count: '1' })); await E.prepare(job, w.deps);
    const st = step(job, 'still'); st.status = 'running'; st.items = [{ id: 'c1', status: 'submitting', usd: 0.04 }];
    await E.resume(job, w.deps); assert.strictEqual(st.items[0].status, 'uncertain'); assert.strictEqual(mock.state.submits, 0); await mock.close();
  });
  await t('cancel while queued refunds the reservation', async () => {
    const mock = await start(0, { speed: 1 }), w = world(mock); const job = w.job('photo', Object.assign({}, base, { count: '1' }));
    await E.prepare(job, w.deps); await E.estimate(job, 'still', w.deps); const run = E.confirm(job, 'still', w.deps); await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(await E.cancelItem(job, 'still', 'c1', w.deps), true); await run; assert.strictEqual(items(job, 'still')[0].status, 'canceled'); assert.strictEqual(E.totals(job).reserved, 0); assert.strictEqual(mock.state.balance, 10); await mock.close();
  });
  await t('an old starting-frame link is refreshed from the saved copy before the next step', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); const job = w.job('ugc', base); await E.prepare(job, w.deps); await drive(w, job, 'still'); await E.pick(job, 'still', 'c1', w.deps);
    const oldUrl = job.run.rt.stillUrl; job.run.rt.stillAt = Date.now() - 7 * 86400000; await E.estimate(job, 'video', w.deps);
    assert.notStrictEqual(job.run.rt.stillUrl, oldUrl); assert.ok(Date.now() - job.run.rt.stillAt < 5000); assert.ok(events(job).some(e => /Refreshed/.test(e))); await mock.close();
  });
  await t('download blocked: item is completed but flagged; "retry download" recovers', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); const client = w.deps.client; let block = true; const real = client.download.bind(client);
    client.download = async u => { if (block) throw Object.assign(new Error('blocked'), { kind: 'download_blocked' }); return real(u); };
    const job = w.job('photo', Object.assign({}, base, { count: '1' })); await E.prepare(job, w.deps); await drive(w, job, 'still'); const it = items(job, 'still')[0];
    assert.strictEqual(it.status, 'completed'); assert.ok(it.downloadError); assert.ok(!it.tempKey); assert.strictEqual(await E.keep(job, 'still', 'c1', w.deps), null);
    block = false; assert.ok(await E.retryDownload(job, 'still', 'c1', w.deps)); assert.ok(await E.keep(job, 'still', 'c1', w.deps)); await mock.close();
  });
  await t('reference upload failure stops the production before any paid step', async () => {
    const mock = await start(0, { speed: 0.05, blockUpload: true }), w = world(mock); const job = w.job('ugc', base);
    assert.strictEqual(await E.prepare(job, w.deps), false); assert.strictEqual(step(job, 'refs').status, 'failed'); assert.match(step(job, 'refs').error, /proxy/i); assert.strictEqual(mock.state.submits, 0); await mock.close();
  });
  await t('discarding a draft clears it; a new try needs a new estimate and confirmation', async () => {
    const mock = await start(0, { speed: 0.05 }), w = world(mock); const job = w.job('ugc', base); await E.prepare(job, w.deps); await drive(w, job, 'still'); await E.pick(job, 'still', 'c1', w.deps);
    await drive(w, job, 'video'); await E.discard(job, 'video', w.deps); const v = step(job, 'video'); assert.strictEqual(v.status, 'planned'); assert.strictEqual(v.items.length, 0);
    const subs = mock.state.submits; await E.estimate(job, 'video', w.deps); assert.strictEqual(v.status, 'confirm'); assert.strictEqual(mock.state.submits, subs); await mock.close();
  });

  console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})();
function events(job) { return job.run.events.map(e => e.msg); }
