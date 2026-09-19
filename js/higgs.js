/* Higgsfield API client — transport + the safety rules that protect your money.
   Built from the official docs (docs.higgsfield.ai): auth header, async request lifecycle, estimate endpoint,
   upload flow, error table. No DOM here, so it is testable in Node against a mock server (tools/).

   Rules baked in:
   - Every job is priced with the estimate endpoint BEFORE it is submitted (estimate is free).
   - Submissions have no idempotency key, so a submit is NEVER auto-retried after an unclear failure
     (timeout / network drop / HTTP 500): it is reported as "uncertain" so the user can check instead of paying twice.
     Only clean rejections (400 concurrency limit, 423, 503) are retried, because those mean nothing was accepted.
   - Status polling follows the documented back-off (2s -> 10s + jitter) and survives network blips until a deadline.
   - Output files are kept only 7 days by Higgsfield, so callers must download() them. */
(function (root) {
  class HiggsError extends Error {
    constructor(kind, message, extra) { super(message); this.name = 'HiggsError'; this.kind = kind; Object.assign(this, extra || {}); }
  }

  const TERMINAL = ['completed', 'failed', 'nsfw', 'canceled'];
  const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/wav', 'video/mp4'];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jitter = ms => ms + Math.random() * Math.min(500, ms / 4);

  function classify(status, data, headers) {
    const detail = data && (typeof data.detail === 'string' ? data.detail : (data.message || data.error || (data.detail && JSON.stringify(data.detail)))) || '';
    const extra = { status, detail, correlationId: headers && headers.get ? headers.get('x-correlation-id') : undefined };
    if (status === 401) return new HiggsError('auth', 'Higgsfield rejected the API key. Check the key ID and secret in Settings.', extra);
    if (status === 403) return new HiggsError('credits', detail || 'Not enough balance in your Higgsfield API account (or this model isn’t enabled for it).', extra);
    if (status === 404) return new HiggsError('notfound', detail || 'Not found.', extra);
    if (status === 422) return new HiggsError('validation', 'Higgsfield refused the request settings: ' + (detail || 'invalid parameters'), extra);
    if (status === 400 && /concurrent/i.test(detail)) return new HiggsError('concurrency', 'Too many generations running at once — waiting for a free slot.', Object.assign({ retryable: true }, extra));
    if (status === 400) return new HiggsError('bad_request', detail || 'Higgsfield refused the request.', extra);
    if (status === 423 || status === 503) return new HiggsError('unavailable', 'Higgsfield is temporarily unavailable for this model.', Object.assign({ retryable: true }, extra));
    if (status >= 500) return new HiggsError('server', 'Higgsfield had an internal error.', Object.assign({ retryable: true }, extra));
    return new HiggsError('unknown', `Unexpected reply (${status}). ${detail}`, extra);
  }

  function createClient(cfg) {
    cfg = cfg || {};
    const doFetch = cfg.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!doFetch) throw new Error('fetch is not available');
    const mode = cfg.mode === 'proxy' ? 'proxy' : 'direct';
    const base = String(mode === 'proxy' ? cfg.proxyUrl || '' : cfg.baseUrl || 'https://api.higgsfield.ai').replace(/\/+$/, '');
    const pollMin = cfg.pollMinMs || 2000, pollMax = cfg.pollMaxMs || 10000;
    if (!base) throw new HiggsError('config', 'No Higgsfield address configured.');
    if (mode === 'direct' && (!cfg.keyId || !cfg.keySecret)) throw new HiggsError('config', 'Add your Higgsfield API key ID and secret in Settings.');

    const authHeaders = () => (mode === 'direct' ? { Authorization: `Key ${cfg.keyId}:${cfg.keySecret}` } : (cfg.proxyToken ? { 'X-Studio-Token': cfg.proxyToken } : {}));

    // One HTTP call. Network problems / timeouts are reported as { kind:'network', ambiguous:true }.
    async function http(method, path, opts) {
      opts = opts || {};
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 30000);
      const headers = Object.assign({}, authHeaders(), opts.headers || {});
      let body;
      if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); } else if (opts.body !== undefined) body = opts.body;
      let res;
      try { res = await doFetch(base + path, { method, headers, body, signal: ctl.signal }); }
      catch (e) {
        throw new HiggsError('network', e && e.name === 'AbortError' ? 'The request timed out.' : 'Couldn’t reach Higgsfield — check the connection (or the proxy address).', { ambiguous: true, retryable: true });
      } finally { clearTimeout(timer); }
      let data = null; const ct = (res.headers.get && res.headers.get('content-type')) || '';
      try { data = /json/.test(ct) ? await res.json() : await res.text(); } catch (e) { data = null; }
      if (!res.ok && res.status !== 202) throw classify(res.status, data, res.headers);
      return { status: res.status, data, headers: res.headers };
    }

    // Retry helper for calls that are safe to repeat. `should(err)` decides which failures are worth another go.
    async function withRetry(fn, should, tries, baseMs) {
      let last;
      for (let i = 0; i < tries; i++) {
        try { return await fn(); } catch (e) { last = e; if (!should(e) || i === tries - 1) throw e; await sleep(jitter((baseMs || 800) * Math.pow(2, i))); }
      }
      throw last;
    }
    const transient = e => e instanceof HiggsError && ['network', 'server', 'unavailable'].includes(e.kind);

    const api = {
      mode, base,

      // Free. Also the safest way to verify credentials and settings: 401 = bad key, 422 = bad parameters, 200 = good.
      async estimate(endpoint, body) {
        const r = await withRetry(() => http('POST', '/estimate/' + endpoint, { json: body }), transient, 3);
        const d = r.data || {};
        const usd = parseFloat(d.usd), credits = parseFloat(d.credits);
        if (!isFinite(usd)) throw new HiggsError('unexpected', 'Higgsfield’s price estimate came back in an unexpected format.', { detail: JSON.stringify(d) });
        return { usd, credits: isFinite(credits) ? credits : null };
      },

      // Costs money. NOT retried after an unclear failure (see file header).
      async submit(endpoint, body) {
        const attempt = () => http('POST', '/' + endpoint, { json: body, timeoutMs: 45000 });
        // clean rejections only: 400-concurrency / 423 / 503 mean the request was not accepted
        let r, waits = 0;
        for (;;) {
          try { r = await attempt(); break; }
          catch (e) {
            const safe = e instanceof HiggsError && (e.kind === 'concurrency' || e.kind === 'unavailable');
            if (safe && waits < 6) { waits++; await sleep(jitter(Math.min(2000 * waits, 10000))); continue; }
            if (e.kind === 'server') e.ambiguous = true;
            throw e;
          }
        }
        const d = r.data || {};
        if (!d.request_id) throw new HiggsError('unexpected', 'Higgsfield accepted the request but sent no request ID.', { ambiguous: true, detail: JSON.stringify(d).slice(0, 200) });
        return { requestId: d.request_id, status: d.status || 'queued' };
      },

      normalize(d) {
        d = d || {};
        const images = (d.images || []).map(i => i && i.url).filter(Boolean);
        const audio = (d.audio && d.audio.url) || (d.audios && d.audios[0] && d.audios[0].url) || null;
        return { status: d.status, requestId: d.request_id, images, video: (d.video && d.video.url) || null, audio, raw: d };
      },

      async status(requestId) {
        const r = await withRetry(() => http('GET', '/requests/' + encodeURIComponent(requestId) + '/status'), transient, 4);
        return api.normalize(r.data);
      },

      // Wait until the request reaches a terminal state. Survives network blips; gives up at the deadline (the request may still run).
      async poll(requestId, o) {
        o = o || {};
        const deadline = Date.now() + (o.deadlineMs || 15 * 60 * 1000);
        let delay = pollMin, misses = 0;
        for (;;) {
          if (o.signal && o.signal.aborted) throw new HiggsError('aborted', 'Stopped watching this request.', { requestId });
          try {
            const s = await api.status(requestId); misses = 0;
            if (o.onUpdate) o.onUpdate(s);
            if (TERMINAL.includes(s.status)) return s;
          } catch (e) {
            if (e instanceof HiggsError && (e.kind === 'auth' || e.kind === 'notfound')) throw e;
            if (++misses > 8) throw e;
          }
          if (Date.now() + delay > deadline) throw new HiggsError('timeout', 'This is taking longer than expected. It may still finish — you can keep waiting.', { requestId });
          await sleep(jitter(delay));
          delay = Math.min(delay * 1.5, pollMax);
        }
      },

      async cancel(requestId) {
        try { await http('POST', '/requests/' + encodeURIComponent(requestId) + '/cancel'); return true; }
        catch (e) { if (e.kind === 'bad_request') return false; throw e; } // 400 = already started, can't cancel
      },

      // Returns the public URL to use as image_url / video_url / audio_url in a generation request.
      async upload(blob, contentType) {
        const ct = contentType || blob.type;
        if (!UPLOAD_TYPES.includes(ct)) throw new HiggsError('unsupported_type', `Higgsfield accepts JPEG, PNG, WebP, GIF, WAV audio and MP4 video — not ${ct || 'this file type'}.`);
        if (mode === 'proxy') {
          const r = await http('POST', '/upload', { body: blob, headers: { 'Content-Type': ct }, timeoutMs: 180000 });
          if (!r.data || !r.data.public_url) throw new HiggsError('upload', 'The proxy did not return a file address.');
          return r.data.public_url;
        }
        const g = await withRetry(() => http('POST', '/files/generate-upload-url', { json: { content_type: ct } }), transient, 3);
        const d = g.data || {};
        if (!d.upload_url || !d.public_url) throw new HiggsError('upload', 'Higgsfield did not return an upload address.', { detail: JSON.stringify(d).slice(0, 200) });
        let res;
        try { res = await doFetch(d.upload_url, { method: 'PUT', headers: d.upload_headers || { 'Content-Type': ct }, body: blob }); } // never send API credentials here
        catch (e) { throw new HiggsError('upload_blocked', 'The browser couldn’t upload straight to Higgsfield storage. Use the proxy option in Settings, which uploads for you.', { ambiguous: false }); }
        if (!res.ok) throw new HiggsError('upload', `Upload failed (${res.status}).`, { status: res.status });
        return d.public_url;
      },

      // Output files are deleted after ~7 days, so save them. Falls back to the proxy when the CDN blocks browser reads.
      async download(url) {
        let blob = null, firstErr = null;
        try { const r = await doFetch(url); if (r.ok) blob = await r.blob(); else firstErr = new HiggsError('download', `Download failed (${r.status}).`, { status: r.status }); }
        catch (e) { firstErr = new HiggsError('download_blocked', 'The browser was blocked from downloading the result directly.', { url }); }
        if (!blob && mode === 'proxy') {
          try { const res = await doFetch(base + '/download?url=' + encodeURIComponent(url), { headers: authHeaders() }); if (res.ok) blob = await res.blob(); } catch (e) { /* keep the first error */ }
        }
        if (!blob) throw firstErr || new HiggsError('download', 'Download failed.', { url });
        if (!blob.size) throw new HiggsError('download', 'The downloaded file was empty.', { url });
        return blob;
      }
    };
    return api;
  }

  const api = { createClient, HiggsError, TERMINAL, UPLOAD_TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CSHiggs = api;
})(typeof window !== 'undefined' ? window : globalThis);
