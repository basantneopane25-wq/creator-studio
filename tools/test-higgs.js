/* Tests for js/higgs.js against the mock server.   node tools/test-higgs.js */
const assert = require('assert');
const { start, png } = require('./mock-higgsfield');
const { createClient, HiggsError } = require('../js/higgs.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); } }
const rejects = async (p, kind) => { try { await p; } catch (e) { assert.ok(e instanceof HiggsError, 'not a HiggsError: ' + e); if (kind) assert.strictEqual(e.kind, kind, `expected kind ${kind}, got ${e.kind}: ${e.message}`); return e; } assert.fail('expected rejection'); };

(async () => {
  const fast = await start(0, { speed: 0.05 });
  const slowMock = await start(0, { speed: 1 });
  const mk = (m, o) => createClient(Object.assign({ mode: 'direct', baseUrl: m.url, keyId: 'test', keySecret: 'secret', pollMinMs: 15, pollMaxMs: 40 }, o));
  const c = mk(fast);

  console.log('config & auth');
  await t('missing key is a config error', async () => { assert.throws(() => createClient({ mode: 'direct', baseUrl: fast.url }), /API key/); });
  await t('wrong key -> auth error, nothing charged', async () => { await rejects(mk(fast, { keySecret: 'nope' }).estimate('higgsfield-ai/soul/v2/standard', { prompt: 'x' }), 'auth'); });
  await t('proxy mode sends the studio token and never an API key', async () => {
    let seen; const cl = createClient({ mode: 'proxy', proxyUrl: 'https://p.example', proxyToken: 'tok', fetch: async (u, i) => { seen = { u, h: i.headers }; return new Response(JSON.stringify({ usd: '0.1', credits: '1' }), { headers: { 'content-type': 'application/json' } }); } });
    await cl.estimate('a/b', {}); assert.strictEqual(seen.h['X-Studio-Token'], 'tok'); assert.ok(!seen.h.Authorization); assert.strictEqual(seen.u, 'https://p.example/estimate/a/b');
  });

  console.log('estimate');
  await t('estimate returns dollars and is free', async () => {
    const e = await c.estimate('kling-video/v3.0/std/image-to-video', { image_url: 'https://x/y.jpg', prompt: 'p', duration: 5 });
    assert.ok(Math.abs(e.usd - 0.21) < 0.001, 'usd ' + e.usd); assert.strictEqual(fast.state.submits, 0);
  });
  await t('estimate catches bad settings for free (422 -> validation)', async () => {
    const e = await rejects(c.estimate('kling-video/v3.0/std/image-to-video', { image_url: 'https://x/y.jpg', duration: 99 }), 'validation');
    assert.match(e.message, /duration/); assert.strictEqual(fast.state.submits, 0);
  });
  await t('estimate rejects fields the model does not have', async () => { await rejects(c.estimate('kling-video/v3.0/std/image-to-video', { image_url: 'https://x/y.jpg', aspect_ratio: '9:16' }), 'validation'); });

  console.log('generation lifecycle');
  await t('image: submit -> poll -> completed, charged only on completion', async () => {
    const b0 = fast.state.balance;
    const s = await c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'a portrait', aspect_ratio: '9:16' });
    assert.ok(s.requestId); assert.strictEqual(fast.state.balance, b0, 'charged too early');
    const seen = []; const r = await c.poll(s.requestId, { onUpdate: x => seen.push(x.status) });
    assert.strictEqual(r.status, 'completed'); assert.strictEqual(r.images.length, 1); assert.ok(seen.includes('queued') || seen.includes('in_progress'));
    assert.ok(Math.abs((b0 - fast.state.balance) - 0.0032) < 1e-6);
    const blob = await c.download(r.images[0]); assert.ok(blob.size > 50);
  });
  await t('video: kling image-to-video completes with a video url', async () => {
    const s = await c.submit('kling-video/v3.0/std/image-to-video', { image_url: 'https://x/y.jpg', prompt: 'walks forward', duration: 5, sound: 'on' });
    const r = await c.poll(s.requestId); assert.strictEqual(r.status, 'completed'); assert.match(r.video, /\.mp4$/);
  });
  await t('nsfw and failed end without charge', async () => {
    const b0 = fast.state.balance;
    for (const [tag, want] of [['nsfw', 'nsfw'], ['fail', 'failed']]) { const s = await c.submit('higgsfield-ai/soul/v2/standard', { prompt: `x [[${tag}]]` }); const r = await c.poll(s.requestId); assert.strictEqual(r.status, want); }
    assert.strictEqual(fast.state.balance, b0);
  });
  await t('insufficient credits -> credits error', async () => { await rejects(c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'x [[credits]]' }), 'credits'); });

  console.log('safety: never pay twice');
  await t('400 concurrency limit is retried (nothing was accepted)', async () => {
    const before = Object.keys(fast.state.requests).length;
    const s = await c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'x [[busy]]' });
    assert.ok(s.requestId); assert.strictEqual(Object.keys(fast.state.requests).length, before + 1);
  });
  await t('503 is retried (nothing was accepted)', async () => {
    const before = Object.keys(fast.state.requests).length;
    const s = await c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'x [[503]]' });
    assert.ok(s.requestId); assert.strictEqual(Object.keys(fast.state.requests).length, before + 1);
  });
  await t('LOST REPLY (server accepted, answered 500): reported ambiguous and NOT resubmitted', async () => {
    const reqs = Object.keys(fast.state.requests).length, subs = fast.state.submits;
    const e = await rejects(c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'x [[lost]]' }), 'server');
    assert.strictEqual(e.ambiguous, true); assert.strictEqual(fast.state.submits, subs + 1, 'client resubmitted!'); assert.strictEqual(Object.keys(fast.state.requests).length, reqs + 1);
  });
  await t('network drop on submit is ambiguous and not retried', async () => {
    let calls = 0; const cl = createClient({ mode: 'direct', keyId: 'a', keySecret: 'b', baseUrl: 'http://x', fetch: async () => { calls++; throw new TypeError('fetch failed'); } });
    const e = await rejects(cl.submit('a/b', {}), 'network'); assert.strictEqual(e.ambiguous, true); assert.strictEqual(calls, 1);
  });

  console.log('polling & cancel');
  await t('poll survives temporary network failures', async () => {
    const s = await c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'blip' }); let fails = 0;
    const flaky = createClient({ mode: 'direct', keyId: 'test', keySecret: 'secret', baseUrl: fast.url, pollMinMs: 10, pollMaxMs: 20, fetch: (u, i) => (/status$/.test(u) && fails++ < 3 ? Promise.reject(new TypeError('offline')) : fetch(u, i)) });
    const r = await flaky.poll(s.requestId); assert.strictEqual(r.status, 'completed');
  });
  await t('poll deadline -> timeout error that keeps the request id', async () => {
    const s = await c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'slow [[slow]]' });
    const e = await rejects(c.poll(s.requestId, { deadlineMs: 5 }), 'timeout'); assert.strictEqual(e.requestId, s.requestId);
  });
  await t('poll stops at once on 404', async () => { await rejects(c.poll('nope'), 'notfound'); });
  await t('cancel works while queued, refused once started', async () => {
    const sc = mk(slowMock);
    const a = await sc.submit('higgsfield-ai/soul/v2/standard', { prompt: 'a' }); assert.strictEqual(await sc.cancel(a.requestId), true);
    const r = await sc.poll(a.requestId); assert.strictEqual(r.status, 'canceled'); assert.strictEqual(slowMock.state.balance, 10);
    const b = await sc.submit('higgsfield-ai/soul/v2/standard', { prompt: 'b' }); await new Promise(r => setTimeout(r, 450));
    assert.strictEqual(await sc.cancel(b.requestId), false);
  });

  console.log('files');
  await t('upload -> public url -> download roundtrip, no credentials sent to storage', async () => {
    const bytes = png(8, 8, [1, 2, 3]), blob = new Blob([bytes], { type: 'image/png' });
    const url = await c.upload(blob); assert.match(url, /\/cdn\//);
    const back = Buffer.from(await (await c.download(url)).arrayBuffer()); assert.ok(back.equals(bytes));
  });
  await t('unsupported upload type rejected before any network call', async () => {
    const n = fast.state.log.length; await rejects(c.upload(new Blob(['x'], { type: 'audio/mpeg' })), 'unsupported_type'); assert.strictEqual(fast.state.log.length, n);
  });
  await t('blocked storage upload gives a clear proxy hint', async () => {
    const blocked = await start(0, { blockUpload: true }); const bc = mk(blocked);
    const e = await rejects(bc.upload(new Blob(['x'], { type: 'image/png' })), 'upload_blocked'); assert.match(e.message, /proxy/i); await blocked.close();
  });
  await t('download: 404 and empty files are errors', async () => {
    await rejects(c.download(fast.url + '/cdn/missing.png'), 'download');
    fast.state.files['empty.png'] = { body: Buffer.alloc(0), type: 'image/png' }; await rejects(c.download(fast.url + '/cdn/empty.png'), 'download');
  });
  await t('download falls back to the proxy when the CDN blocks the browser', async () => {
    let asked; const cl = createClient({ mode: 'proxy', proxyUrl: 'https://p.example', proxyToken: 't', fetch: async (u) => { if (u.startsWith('https://cdn.example')) throw new TypeError('cors'); asked = u; return new Response(new Uint8Array([1, 2, 3])); } });
    const b = await cl.download('https://cdn.example/v.mp4'); assert.strictEqual(b.size, 3); assert.match(asked, /p\.example\/download\?url=/);
  });

  await fast.close(); await slowMock.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})();
