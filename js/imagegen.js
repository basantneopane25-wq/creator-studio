/* In-app picture generation. Two providers, chosen in Settings:
   - "free"   — Pollinations, no account or key. Handy for quick pics, but slow at times and it can't keep one face across pictures.
   - "custom" — any OpenAI-compatible images endpoint (OpenAI, Together, …) with your own key. Billed by that provider.
   The key is stored only in this browser. Videos, and pictures that must keep the creator's locked face, still go through Higgsfield via Claude. */
(function (CS) {
  const SIZES = { '1:1': [768, 768], '4:5': [768, 960], '9:16': [720, 1280], '16:9': [1280, 720] };
  const OPENAI_SIZES = {
    'gpt-image': { '1:1': '1024x1024', '4:5': '1024x1536', '9:16': '1024x1536', '16:9': '1536x1024' },
    'dall-e-3': { '1:1': '1024x1024', '4:5': '1024x1792', '9:16': '1024x1792', '16:9': '1792x1024' },
    'dall-e-2': { '1:1': '1024x1024', '4:5': '1024x1024', '9:16': '1024x1024', '16:9': '1024x1024' }
  };
  const TIMEOUT = 120000;

  const G = CS.imagegen = { SIZES };
  G.settings = () => Object.assign({ provider: 'free', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: '' }, CS.S.settings.imagegen || {});
  G.ready = () => { const s = G.settings(); return s.provider === 'free' || !!s.apiKey; };
  G.label = () => (G.settings().provider === 'free' ? 'free service' : G.settings().model);

  async function fetchTimed(url, init) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
    try { return await fetch(url, Object.assign({ signal: ctl.signal }, init)); }
    catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Took too long (over 2 minutes). Try again.');
      throw new Error('Couldn’t reach the image service — check your connection. (A custom provider may also be blocking browser requests.)');
    } finally { clearTimeout(t); }
  }

  async function free(prompt, aspect, seed) {
    const sz = SIZES[aspect] || SIZES['1:1'];
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt.slice(0, 900)) +
      `?width=${sz[0]}&height=${sz[1]}&seed=${seed}&nologo=true&model=flux`;
    const r = await fetchTimed(url);
    if (r.status === 429) throw new Error('The free service is busy (it handles one picture at a time) — wait a minute and try again.');
    if (r.status === 403) throw new Error('The free service refused this request — it asks for a human check on some websites. Try from your live site, or add your own key in Settings.');
    if (!r.ok) throw new Error('The free service returned an error (' + r.status + ').');
    const b = await r.blob();
    if (!/^image\//.test(b.type)) throw new Error('The free service didn’t return a picture. Try again.');
    return b;
  }

  async function custom(prompt, aspect, s) {
    const model = s.model || 'gpt-image-1';
    const family = /dall-e-3/i.test(model) ? 'dall-e-3' : /dall-e-2/i.test(model) ? 'dall-e-2' : 'gpt-image';
    const body = { model, prompt: prompt.slice(0, 3800), n: 1, size: OPENAI_SIZES[family][aspect] || '1024x1024' };
    if (family !== 'gpt-image') body.response_format = 'b64_json';
    const r = await fetchTimed(s.baseUrl.replace(/\/+$/, '') + '/images/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey }, body: JSON.stringify(body)
    });
    let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok) throw new Error((j && j.error && (j.error.message || j.error)) || 'The provider returned an error (' + r.status + ').');
    const d = j && j.data && j.data[0];
    if (d && d.b64_json) { const bin = atob(d.b64_json), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Blob([u8], { type: 'image/png' }); }
    if (d && d.url) { const img = await fetchTimed(d.url); return img.blob(); }
    throw new Error('The provider’s reply had no picture in it.');
  }

  // -> Blob (image). `seed` only matters for the free service.
  G.generate = (prompt, aspect, seed) => {
    const s = G.settings();
    return s.provider === 'free' ? free(prompt, aspect, seed) : custom(prompt, aspect, s);
  };
})(window.CS);
