/* Mock of the Higgsfield API, built from the official docs (docs.higgsfield.ai), for testing without spending money.
   Dev tool only — not used by the app in production.

   Run:   node tools/mock-higgsfield.js 8787        (key  test:secret)
   Test hooks — put one of these anywhere in a prompt:
     [[nsfw]]  -> ends as "nsfw"          [[fail]] -> ends as "failed"        [[slow]] -> stays in_progress ~6s
     [[busy]]  -> first submit gets 400 "Maximum number of concurrent requests"
     [[503]]   -> first submit gets 503                 [[credits]] -> 403
     [[lost]]  -> request IS accepted but the reply is a 500 (the dangerous "ambiguous" case) */
const http = require('http');
const zlib = require('zlib');

const IMG = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'];
const MODELS = {
  'higgsfield-ai/soul/v2/standard': { kind: 'image', req: ['prompt'], enums: { aspect_ratio: IMG, resolution: ['720p', '1080p'], batch_size: [1, 4] }, ints: { seed: [1, 1000000] }, price: 0.0032, other: ['style_id', 'enhance_prompt'] },
  'xai/grok-imagine-image-2.0': { kind: 'image', req: ['prompt'], enums: { quality: ['low', 'medium'], resolution: ['1k', '2k'], aspect_ratio: ['auto', '1:1', '1:2', '2:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] }, arrays: { image_urls: [0, 10] }, price: 0.04 },
  'kling-video/v3.0/std/image-to-video': { kind: 'video', req: ['image_url'], enums: { sound: ['on', 'off'] }, ints: { duration: [3, 15] }, nums: { cfg_scale: [0, 1] }, arrays: { elements: [0, 99], multi_prompt: [1, 6] }, other: ['prompt', 'multi_shots', 'last_image_url'], perSec: 0.042 },
  'kling-video/v3.0/pro/image-to-video': { kind: 'video', req: ['image_url'], enums: { sound: ['on', 'off'] }, ints: { duration: [3, 15] }, nums: { cfg_scale: [0, 1] }, arrays: { elements: [0, 99], multi_prompt: [1, 6] }, other: ['prompt', 'multi_shots', 'last_image_url'], perSec: 0.084 },
  'kling-video/v3.0-turbo/image-to-video': { kind: 'video', req: ['prompt', 'image_url'], enums: { resolution: ['720p', '1080p'] }, ints: { duration: [3, 15] }, perSec: 0.03 },
  'kling-video/v3.0/std/text-to-video': { kind: 'video', req: [], enums: { sound: ['on', 'off'], aspect_ratio: ['16:9', '9:16', '1:1'] }, ints: { duration: [3, 15] }, nums: { cfg_scale: [0, 1] }, arrays: { elements: [0, 99], multi_prompt: [1, 6] }, other: ['prompt', 'multi_shots'], perSec: 0.042 },
  'bytedance/seedance-2.0/image-to-video': { kind: 'video', req: ['image_url'], enums: { resolution: ['480p', '720p', '1080p', '4k'] }, ints: { duration: [4, 15] }, bools: ['generate_audio'], other: ['prompt', 'end_image_url'], perSec: 0.0985 },
  'bytedance/seedance-2.0/reference-to-video': { kind: 'video', req: ['aspect_ratio', 'duration'], enums: { resolution: ['480p', '720p', '1080p', '4k'], aspect_ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] }, ints: { duration: [4, 15] }, bools: ['generate_audio'], arrays: { image_urls: [0, 9], video_urls: [0, 3], audio_urls: [0, 3] }, other: ['prompt'], perSec: 0.0985, needsRef: true },
  'bytedance/seedance-2.0/text-to-video': { kind: 'video', req: ['prompt'], enums: { resolution: ['480p', '720p', '1080p', '4k'], aspect_ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] }, ints: { duration: [4, 15] }, bools: ['generate_audio'], perSec: 0.0985 }
};

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function start(port, opts) {
  opts = opts || {};
  const KEY = opts.key || 'test:secret';
  const speed = opts.speed || 1;                       // < 1 = faster
  const state = { balance: opts.balance != null ? opts.balance : 10, requests: {}, files: {}, log: [], submits: 0, once: {}, maxConcurrent: opts.maxConcurrent || 20, seq: 1 };
  const send = (res, code, body, headers) => {
    const h = Object.assign({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Studio-Token, x-amz-tagging', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Expose-Headers': 'X-Correlation-ID', 'X-Correlation-ID': 'mock-' + state.seq }, headers);
    if (Buffer.isBuffer(body)) { res.writeHead(code, h); res.end(body); return; }
    h['Content-Type'] = 'application/json'; res.writeHead(code, h); res.end(JSON.stringify(body));
  };
  const cost = (m, b) => (m.kind === 'image' ? m.price * (b.batch_size || 1) : m.perSec * (b.duration || 5));

  function validate(m, b) {
    const errs = [];
    if (!b || typeof b !== 'object') return ['body must be a JSON object'];
    const known = new Set([].concat(m.req, m.other || [], Object.keys(m.enums || {}), Object.keys(m.ints || {}), Object.keys(m.nums || {}), Object.keys(m.arrays || {}), m.bools || [], ['prompt']));
    Object.keys(b).forEach(k => { if (!known.has(k)) errs.push(`unknown field "${k}"`); });
    m.req.forEach(k => { if (b[k] === undefined || b[k] === '') errs.push(`"${k}" is required`); });
    Object.entries(m.enums || {}).forEach(([k, v]) => { if (b[k] !== undefined && !v.includes(b[k])) errs.push(`"${k}" must be one of ${v.join(', ')}`); });
    Object.entries(m.ints || {}).forEach(([k, [lo, hi]]) => { if (b[k] !== undefined && !(Number.isInteger(b[k]) && b[k] >= lo && b[k] <= hi)) errs.push(`"${k}" must be an integer ${lo}-${hi}`); });
    Object.entries(m.nums || {}).forEach(([k, [lo, hi]]) => { if (b[k] !== undefined && !(typeof b[k] === 'number' && b[k] >= lo && b[k] <= hi)) errs.push(`"${k}" must be ${lo}-${hi}`); });
    Object.entries(m.arrays || {}).forEach(([k, [lo, hi]]) => { if (b[k] !== undefined && !(Array.isArray(b[k]) && b[k].length >= lo && b[k].length <= hi)) errs.push(`"${k}" must be a list of ${lo}-${hi} items`); });
    (m.bools || []).forEach(k => { if (b[k] !== undefined && typeof b[k] !== 'boolean') errs.push(`"${k}" must be true/false`); });
    if (b.prompt !== undefined && typeof b.prompt === 'string' && b.prompt.length > 2500) errs.push('"prompt" is longer than 2500 characters');
    ['image_url', 'end_image_url', 'last_image_url'].forEach(k => { if (b[k] !== undefined && !/^https?:\/\//.test(b[k])) errs.push(`"${k}" must be a public URL`); });
    [].concat(b.image_urls || [], b.video_urls || [], b.audio_urls || []).forEach(u => { if (!/^https?:\/\//.test(u)) errs.push('reference URLs must be public URLs'); });
    if (m.needsRef && !((b.image_urls || []).length || (b.video_urls || []).length)) errs.push('at least one reference image or video is required');
    if (b.multi_shots && !(b.multi_prompt || []).length) errs.push('"multi_prompt" is required when multi_shots is true');
    (b.multi_prompt || []).forEach((s, i) => { if (!s || typeof s.prompt !== 'string' || s.prompt.length > 512) errs.push(`multi_prompt[${i}].prompt must be text up to 512 characters`); if (!s || !Number.isInteger(s.duration) || s.duration < 1 || s.duration > 15) errs.push(`multi_prompt[${i}].duration must be 1-15`); });
    return errs;
  }

  function advance(r) { // status is derived from elapsed time so polling needs no timers
    if (r.status === 'canceled' || ['completed', 'failed', 'nsfw'].includes(r.status)) return;
    const t = (Date.now() - r.created) / speed, tag = r.tag;
    if (t < 300) r.status = 'queued';
    else if (tag === 'slow' && t < 6000) r.status = 'in_progress';
    else if (t < 900) r.status = 'in_progress';
    else if (tag === 'nsfw') r.status = 'nsfw';
    else if (tag === 'fail') r.status = 'failed';
    else {
      r.status = 'completed';
      if (!r.charged) { r.charged = true; state.balance -= r.cost; }
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks), path = url.pathname, auth = req.headers.authorization || '';
      state.log.push({ method: req.method, path, auth: !!auth, len: raw.length });
      if (req.method === 'OPTIONS') return send(res, 204, Buffer.alloc(0));
      // storage endpoints (no API credentials allowed here)
      if (path.startsWith('/_upload/') && req.method === 'PUT') {
        if (auth) return send(res, 400, { detail: 'credentials must not be sent to storage' });
        if (opts.blockUpload) { req.socket.destroy(); return; }
        state.files[path.split('/').pop()] = { body: raw, type: req.headers['content-type'] || 'application/octet-stream' };
        return send(res, 200, Buffer.alloc(0));
      }
      if (path.startsWith('/cdn/') && req.method === 'GET') {
        const f = state.files[path.split('/').pop()]; if (!f) return send(res, 404, { detail: 'gone' });
        return send(res, 200, f.body, { 'Content-Type': f.type });
      }
      if (path === '/_mock/state') return send(res, 200, { balance: state.balance, submits: state.submits, log: state.log.length });
      // everything below needs the key
      if (auth !== 'Key ' + KEY) return send(res, 401, { detail: 'Invalid credentials' });
      const host = 'http://' + req.headers.host;
      let body = null; if (raw.length && /json/.test(req.headers['content-type'] || '')) { try { body = JSON.parse(raw.toString()); } catch (e) { return send(res, 422, { detail: 'invalid JSON' }); } }

      if (path === '/files/generate-upload-url' && req.method === 'POST') {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/wav', 'video/mp4'];
        if (!body || !ok.includes(body.content_type)) return send(res, 422, { detail: 'unsupported content_type' });
        const id = 'f' + (state.seq++) + '.' + body.content_type.split('/')[1].replace('wav', 'wav');
        return send(res, 200, { public_url: `${host}/cdn/${id}`, upload_url: `${host}/_upload/${id}`, upload_headers: { 'Content-Type': body.content_type, 'x-amz-tagging': 'retention=temporary' } });
      }
      let m = path.match(/^\/requests\/([^/]+)\/(status|cancel)$/);
      if (m) {
        const r = state.requests[m[1]]; if (!r) return send(res, 404, { detail: 'request not found' });
        if (m[2] === 'status' && req.method === 'GET') {
          advance(r);
          const out = { status: r.status, request_id: r.id };
          if (r.status === 'completed') { if (r.model.kind === 'image') out.images = r.outputs.map(url => ({ url })); else out.video = { url: r.outputs[0] }; }
          return send(res, 200, out);
        }
        if (m[2] === 'cancel' && req.method === 'POST') {
          advance(r);
          if (r.status !== 'queued') return send(res, 400, { detail: 'request already started' });
          r.status = 'canceled'; return send(res, 202, { status: 'canceled' });
        }
      }
      m = path.match(/^\/estimate\/(.+)$/);
      if (m && req.method === 'POST') {
        const mod = MODELS[m[1]]; if (!mod) return send(res, 404, { detail: 'unknown model' });
        const errs = validate(mod, body); if (errs.length) return send(res, 422, { detail: errs.join('; ') });
        const usd = cost(mod, body); return send(res, 200, { credits: (usd / 0.0627).toFixed(3), usd: usd.toFixed(3) });
      }
      m = path.match(/^\/(.+)$/);
      const model = m && MODELS[m[1]];
      if (model && req.method === 'POST') {
        const errs = validate(model, body); if (errs.length) return send(res, 422, { detail: errs.join('; ') });
        const p = body.prompt || '', tag = (p.match(/\[\[(nsfw|fail|slow|busy|503|credits|lost)\]\]/) || [])[1];
        state.submits++;
        if (tag === 'credits') return send(res, 403, { detail: 'Not enough credits' });
        if (tag === 'busy' && !state.once.busy) { state.once.busy = 1; return send(res, 400, { detail: 'Maximum number of concurrent requests (4) has been reached' }); }
        if (tag === '503' && !state.once['503']) { state.once['503'] = 1; return send(res, 503, { detail: 'model unavailable' }); }
        const running = Object.values(state.requests).filter(r => { advance(r); return r.status === 'queued' || r.status === 'in_progress'; }).length;
        if (running >= state.maxConcurrent) return send(res, 400, { detail: `Maximum number of concurrent requests (${state.maxConcurrent}) has been reached` });
        const c = cost(model, body);
        if (state.balance < c) return send(res, 403, { detail: 'Not enough credits' });
        const id = 'req-' + (state.seq++);
        const n = model.kind === 'image' ? (body.batch_size || 1) : 1;
        const outputs = []; for (let i = 0; i < n; i++) { const fid = `o${state.seq++}.${model.kind === 'image' ? 'png' : 'mp4'}`; state.files[fid] = model.kind === 'image' ? { body: png(64, 96, [60 + i * 40, 90, 180]), type: 'image/png' } : { body: Buffer.from('FAKE-MP4-BYTES-' + id), type: 'video/mp4' }; outputs.push(`${host}/cdn/${fid}`); }
        state.requests[id] = { id, model, created: Date.now(), status: 'queued', tag, cost: c, outputs, body };
        if (tag === 'lost') return send(res, 500, { detail: 'internal error' }); // accepted, but the client never learns the request_id
        return send(res, 200, { status: 'queued', request_id: id, status_url: `${host}/requests/${id}/status`, cancel_url: `${host}/requests/${id}/cancel` });
      }
      return send(res, 405, { detail: 'Method Not Allowed' });
    });
  });
  return new Promise(resolve => server.listen(port, () => resolve({ server, state, url: 'http://localhost:' + server.address().port, close: () => new Promise(r => server.close(r)) })));
}

module.exports = { start, MODELS, png };
if (require.main === module) start(parseInt(process.argv[2], 10) || 8787).then(s => console.log('Mock Higgsfield on', s.url, '— key test:secret'));
