/* Creator Studio → Higgsfield proxy (Cloudflare Worker).
   Why: Higgsfield's docs say never to put API keys in browser code. This Worker holds the key as a secret and the app only
   knows a separate "studio token". Anyone who gets the token can still spend your balance through the proxy, but the real key
   never leaves Cloudflare, and the allowed calls are limited to what the app needs.

   Secrets / variables (set with `wrangler secret put …` / wrangler.toml [vars]):
     HF_KEY_ID, HF_KEY_SECRET   your Higgsfield API credentials       (secret)
     STUDIO_TOKEN               long random password the app sends     (secret)
     ALLOWED_ORIGIN             e.g. https://yourname.github.io        (var)  — only this site may call the proxy
     DOWNLOAD_HOSTS             optional regex source for /download    (var)  — default: higgsfield / cloudfront / amazonaws
     ALLOWED_MODELS             optional regex for allowed model paths (var)  — default: the model families the app uses
   Routes:
     /estimate/<model…>, /<model…> (POST)   → forwarded to api.higgsfield.ai with your key
     /requests/<id>/status | /cancel        → forwarded
     POST /upload                            → uploads the request body to Higgsfield storage, returns { public_url }
     GET  /download?url=…                    → streams a result file (only from allowed hosts) so the browser can save it */
const API = 'https://api.higgsfield.ai';
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/wav', 'video/mp4'];
const MAX_UPLOAD = 220 * 1024 * 1024;
const MODEL_PATH = /^\/(estimate\/)?[a-z0-9._-]+(\/[a-z0-9._-]+){1,4}$/i;
// Only model families the app uses may be reached with your key (add more through the ALLOWED_MODELS variable).
const DEFAULT_MODELS = '^/(estimate/)?(higgsfield-ai|higgsfield|kling-video|bytedance|xai|alibaba|minimax|lightricks|ideogram|recraft|marketing-studio)/';
const REQ_PATH = /^\/requests\/[a-z0-9-]+\/(status|cancel)$/i;
const BLOCKED_MODEL_PREFIX = /^\/(files|requests|upload|download)(\/|$)/i;

function cors(env, req, extra) {
  const origin = req.headers.get('Origin') || '';
  const allow = env.ALLOWED_ORIGIN || '';
  const h = new Headers(extra || {});
  if (allow && origin === allow) { h.set('Access-Control-Allow-Origin', origin); h.set('Vary', 'Origin'); }
  h.set('Access-Control-Allow-Headers', 'Content-Type, X-Studio-Token');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Expose-Headers', 'X-Correlation-ID');
  return h;
}
const json = (env, req, status, obj) => new Response(JSON.stringify(obj), { status, headers: cors(env, req, { 'Content-Type': 'application/json' }) });

// constant-time compare so the token can't be guessed byte by byte
function same(a, b) {
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) });
    if (!env.STUDIO_TOKEN || !env.HF_KEY_ID || !env.HF_KEY_SECRET) return json(env, req, 500, { detail: 'The proxy is not configured (missing secrets).' });
    if (env.ALLOWED_ORIGIN && req.headers.get('Origin') && req.headers.get('Origin') !== env.ALLOWED_ORIGIN) return json(env, req, 403, { detail: 'Origin not allowed.' });
    if (!same(req.headers.get('X-Studio-Token'), env.STUDIO_TOKEN)) return json(env, req, 401, { detail: 'Invalid studio token.' });
    const auth = { Authorization: `Key ${env.HF_KEY_ID}:${env.HF_KEY_SECRET}` };
    const path = url.pathname;

    // 1) upload: get a presigned URL from Higgsfield, PUT the bytes there (no credentials sent to storage)
    if (path === '/upload' && req.method === 'POST') {
      const type = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (!UPLOAD_TYPES.includes(type)) return json(env, req, 422, { detail: 'Unsupported file type.' });
      const len = parseInt(req.headers.get('Content-Length') || '0', 10);
      if (len > MAX_UPLOAD) return json(env, req, 413, { detail: 'File too large.' });
      const body = await req.arrayBuffer();
      if (body.byteLength > MAX_UPLOAD) return json(env, req, 413, { detail: 'File too large.' });
      const g = await fetch(API + '/files/generate-upload-url', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), body: JSON.stringify({ content_type: type }) });
      if (!g.ok) return json(env, req, g.status, { detail: 'Higgsfield refused the upload request.' });
      const d = await g.json();
      const put = await fetch(d.upload_url, { method: 'PUT', headers: d.upload_headers || { 'Content-Type': type }, body });
      if (!put.ok) return json(env, req, 502, { detail: `Storage upload failed (${put.status}).` });
      return json(env, req, 200, { public_url: d.public_url });
    }

    // 2) download: stream a finished file (only from allowed hosts, https only)
    if (path === '/download' && req.method === 'GET') {
      let target; try { target = new URL(url.searchParams.get('url') || ''); } catch (e) { return json(env, req, 422, { detail: 'Bad url.' }); }
      const allow = new RegExp(env.DOWNLOAD_HOSTS || '(^|\\.)higgsfield\\.ai$|(^|\\.)cloudfront\\.net$|(^|\\.)amazonaws\\.com$', 'i');
      if (!(target.protocol === 'https:' || (env.ALLOW_HTTP === '1' && target.protocol === 'http:')) || !allow.test(target.hostname)) return json(env, req, 403, { detail: 'That address is not allowed.' });
      const r = await fetch(target.toString());
      return new Response(r.body, { status: r.status, headers: cors(env, req, { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream' }) });
    }

    // 3) everything else: only the documented generation / status calls
    const ok = (REQ_PATH.test(path) && (req.method === 'GET' || req.method === 'POST')) || (MODEL_PATH.test(path) && !BLOCKED_MODEL_PREFIX.test(path) && new RegExp(env.ALLOWED_MODELS || DEFAULT_MODELS, 'i').test(path) && req.method === 'POST') || (/^\/v1\/text2image\/soul-styles(\/v2)?$/.test(path) && req.method === 'GET');
    if (!ok) return json(env, req, 404, { detail: 'Not allowed by the proxy.' });
    const init = { method: req.method, headers: Object.assign({}, auth) };
    if (req.method === 'POST' && !REQ_PATH.test(path)) { init.headers['Content-Type'] = 'application/json'; init.body = await req.text(); }
    const r = await fetch(API + path, init);
    const h = cors(env, req, { 'Content-Type': r.headers.get('Content-Type') || 'application/json' });
    const cid = r.headers.get('X-Correlation-ID'); if (cid) h.set('X-Correlation-ID', cid);
    return new Response(r.body, { status: r.status, headers: h });
  }
};
