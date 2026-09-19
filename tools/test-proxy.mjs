/* Tests for worker/higgsfield-proxy.mjs, run through the app's REAL client against the mock.   node tools/test-proxy.mjs */
import assert from 'assert';
import http from 'http';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { start, png } = require('./mock-higgsfield.js');
const { createClient, HiggsError } = require('../js/higgs.js');
const worker = (await import('../worker/higgsfield-proxy.mjs')).default;

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); } }

const mock = await start(0, { speed: 0.05 });
const realFetch = globalThis.fetch;
const seenAuth = []; // every Authorization header the "internet" (mock) received via the proxy
globalThis.fetch = (u, i) => {
  const s = String(u);
  if (s.startsWith('https://api.higgsfield.ai')) { const h = new Headers(i && i.headers); if (h.get('authorization')) seenAuth.push(h.get('authorization')); return realFetch(mock.url + s.slice('https://api.higgsfield.ai'.length), i); }
  return realFetch(u, i);
};
const ENV = { HF_KEY_ID: 'test', HF_KEY_SECRET: 'secret', STUDIO_TOKEN: 'tok-123', ALLOWED_ORIGIN: 'https://me.github.io', DOWNLOAD_HOSTS: '^localhost$', ALLOW_HTTP: '1' };

// Node http adapter for the Worker (what Cloudflare does for us in production)
const proxy = http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c); const body = Buffer.concat(chunks);
  const req = new Request('http://proxy' + rq.url, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : body });
  const res = await worker.fetch(req, ENV);
  const out = Buffer.from(await res.arrayBuffer()); const h = {}; res.headers.forEach((v, k) => { h[k] = v; });
  rs.writeHead(res.status, h); rs.end(out);
});
await new Promise(r => proxy.listen(0, r)); const PROXY = 'http://localhost:' + proxy.address().port;
const mkc = (o) => createClient(Object.assign({ mode: 'proxy', proxyUrl: PROXY, proxyToken: 'tok-123', pollMinMs: 10, pollMaxMs: 30 }, o));
const raw = (path, o) => realFetch(PROXY + path, o);

console.log('access control');
await t('no token / wrong token -> 401, nothing forwarded', async () => {
  const n = mock.state.log.length;
  assert.strictEqual((await raw('/estimate/higgsfield-ai/soul/v2/standard', { method: 'POST', body: '{}' })).status, 401);
  assert.strictEqual((await raw('/estimate/higgsfield-ai/soul/v2/standard', { method: 'POST', headers: { 'X-Studio-Token': 'nope' }, body: '{}' })).status, 401);
  assert.strictEqual(mock.state.log.length, n);
});
await t('a different website origin is refused', async () => { const r = await raw('/estimate/a/b', { method: 'POST', headers: { 'X-Studio-Token': 'tok-123', Origin: 'https://evil.example' } }); assert.strictEqual(r.status, 403); });
await t('CORS header only for the allowed origin', async () => {
  const ok = await raw('/x', { method: 'OPTIONS', headers: { Origin: 'https://me.github.io' } }); assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://me.github.io');
  const bad = await raw('/x', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }); assert.strictEqual(bad.headers.get('access-control-allow-origin'), null);
});
await t('only documented calls pass; upload/download/files paths cannot be reached through the passthrough', async () => {
  const h = { 'X-Studio-Token': 'tok-123', 'Content-Type': 'application/json' };
  for (const p of ['/files/generate-upload-url', '/account/keys/delete', '/../etc/passwd', '/requests/abc', '/a']) assert.strictEqual((await raw(p, { method: 'POST', headers: h, body: '{}' })).status, 404, p);
  assert.strictEqual((await raw('/higgsfield-ai/soul/v2/standard', { method: 'GET', headers: h })).status, 404);
});
await t('misconfigured proxy fails closed', async () => { const r = await worker.fetch(new Request('http://p/estimate/a/b', { method: 'POST' }), {}); assert.strictEqual(r.status, 500); });

console.log('the real client through the proxy');
await t('estimate / submit / poll work and Higgsfield sees the key the PROXY added', async () => {
  const c = mkc(); const e = await c.estimate('kling-video/v3.0/std/image-to-video', { image_url: 'https://x/y.jpg', duration: 5 }); assert.ok(Math.abs(e.usd - 0.21) < 1e-6);
  const s = await c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'via proxy' }); const r = await c.poll(s.requestId); assert.strictEqual(r.status, 'completed');
  assert.ok(seenAuth.length >= 3 && seenAuth.every(a => a === 'Key test:secret'));
});
await t('errors pass through with their meaning (422 validation, 401 upstream)', async () => {
  const c = mkc(); try { await c.estimate('kling-video/v3.0/std/image-to-video', { image_url: 'https://x/y.jpg', duration: 99 }); assert.fail('x'); } catch (e) { assert.ok(e instanceof HiggsError); assert.strictEqual(e.kind, 'validation'); }
  const bad = mkc({ proxyToken: 'wrong' }); try { await bad.estimate('a/b', {}); assert.fail('x'); } catch (e) { assert.strictEqual(e.kind, 'auth'); }
});
await t('upload through the proxy stores the file; the storage step gets no credentials', async () => {
  const bytes = png(8, 8, [9, 9, 9]); const url = await mkc().upload(new Blob([bytes], { type: 'image/png' })); assert.match(url, /\/cdn\//);
  const back = Buffer.from(await (await realFetch(url)).arrayBuffer()); assert.ok(back.equals(bytes));
  await assert.rejects(mkc().upload(new Blob(['x'], { type: 'text/plain' })), /accepts JPEG/);
});
await t('the proxy refuses unsupported types and oversize declarations', async () => {
  assert.strictEqual((await raw('/upload', { method: 'POST', headers: { 'X-Studio-Token': 'tok-123', 'Content-Type': 'application/zip' }, body: 'x' })).status, 422);
  const big = await worker.fetch(new Request('http://p/upload', { method: 'POST', headers: { 'X-Studio-Token': 'tok-123', 'Content-Type': 'video/mp4', 'Content-Length': String(300 * 1024 * 1024) }, body: 'x' }), ENV); assert.strictEqual(big.status, 413);
});
await t('download goes through the proxy when the CDN blocks the browser; disallowed hosts are refused', async () => {
  const bytes = png(4, 4, [1, 1, 1]); mock.state.files['dl.png'] = { body: bytes, type: 'image/png' };
  const blocked = mkc({ fetch: (u, i) => (String(u).startsWith(PROXY) ? realFetch(u, i) : Promise.reject(new TypeError('cors'))) });
  const b = await blocked.download(mock.url + '/cdn/dl.png'); assert.strictEqual(b.size, bytes.length);
  assert.strictEqual((await raw('/download?url=' + encodeURIComponent('https://evil.example/x'), { headers: { 'X-Studio-Token': 'tok-123' } })).status, 403);
  assert.strictEqual((await raw('/download?url=' + encodeURIComponent('file:///etc/passwd'), { headers: { 'X-Studio-Token': 'tok-123' } })).status, 403);
});
await t('the Higgsfield secret never appears in anything the browser receives', async () => {
  const r = await raw('/estimate/higgsfield-ai/soul/v2/standard', { method: 'POST', headers: { 'X-Studio-Token': 'tok-123', 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'x' }) });
  const txt = await r.text() + JSON.stringify([...r.headers]); assert.ok(!txt.includes('secret') || !txt.includes('Key test'));
  assert.ok(!txt.includes('Key test:secret'));
});

proxy.close(); await mock.close(); globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
