/* Recipes: the production "brain". Pure functions (no DOM) so they can be tested in Node.

   Everything here is grounded in sources gathered in Sept 2026 — see PLAYBOOK below and the in-app Playbook page:
   - Higgsfield API model pages (docs.higgsfield.ai): endpoint ids, allowed values, limits.
   - Kling 3.0 prompting (fal.ai guide): 5-part order Scene -> Character -> Action+dialogue -> Camera -> Progression;
     labelled characters ([Character A: Name, voice]: "line"); image-to-video = describe how the scene EVOLVES from the image.
   - Seedance 2.0 references (MagicHour / ModelArk): refer to assets as "Image 1 / Video 1 / Audio 1", say which asset supplies what.
   - Short-form hook research (TikTok / Meta creative guidance): land the promise in the first ~3 s; problem or result up front.
   A plan is plain JSON (prompts included, editable by the user); bodies are built only at run time from the plan + uploaded URLs. */
(function (root) {
  const R = {};

  /* ---------- verified model catalog ---------- */
  // approx = list price seen 2026-09 (USD). Launch promos apply; the estimate endpoint is always the authority.
  R.MODELS = {
    soul2: { id: 'higgsfield-ai/soul/v2/standard', kind: 'image', label: 'Soul 2', refs: false, aspects: ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2'], approx: { image: 0.0032 } },
    grok: { id: 'xai/grok-imagine-image-2.0', kind: 'image', label: 'Grok Imagine 2.0 (edit with reference photos)', refs: true, maxRefs: 10, aspects: ['auto', '1:1', '1:2', '2:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], approx: { image: 0.04 } },
    klingStd: { id: 'kling-video/v3.0/std/image-to-video', kind: 'video', label: 'Kling 3.0 Standard', duration: [3, 15], sound: true, multi: 6, approx: { sec: 0.042 } },
    klingPro: { id: 'kling-video/v3.0/pro/image-to-video', kind: 'video', label: 'Kling 3.0 Pro', duration: [3, 15], sound: true, multi: 6, approx: { sec: null } },
    klingTurbo: { id: 'kling-video/v3.0-turbo/image-to-video', kind: 'video', label: 'Kling 3.0 Turbo', duration: [3, 15], sound: false, multi: 0, approx: { sec: null } },
    seedRef: { id: 'bytedance/seedance-2.0/reference-to-video', kind: 'video', label: 'Seedance 2.0 (reference to video)', duration: [4, 15], refs: { image: 9, video: 3, audio: 3 }, approx: { sec: 0.0985 } },
    seedI2V: { id: 'bytedance/seedance-2.0/image-to-video', kind: 'video', label: 'Seedance 2.0 (image to video)', duration: [4, 15], approx: { sec: 0.0985 } }
  };

  // Where a saved Soul ID goes in each model's request. Only models that take an identity id are listed; every other
  // model keeps receiving the creator's reference photos. UNVERIFIED: docs.higgsfield.ai publishes no Soul ID field, so
  // this name comes from Higgsfield's older Soul API. The free estimate call rejects a wrong name (422) before any spend.
  R.SOUL_FIELD = { soul2: 'custom_reference_id' };
  // the id of a LOCKED creator ('' when none)
  R.soulIdFor = c => { const cr = c && c.creator; return cr && cr.locked && typeof cr.soulId === 'string' ? cr.soulId.trim() : ''; };

  /* ---------- small helpers ---------- */
  R.WORDS_PER_SEC = 2.5; // comfortable spoken pace; used only to warn when a line can't fit its shot
  R.wordBudget = secs => Math.max(0, Math.floor(secs * R.WORDS_PER_SEC));
  const words = s => (String(s || '').trim().match(/\S+/g) || []).length;
  const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
  // trim a spoken line to what fits in `secs` (a suggestion must never be un-speakable)
  const fit = (s, secs) => { const w = String(s || '').trim().split(/\s+/).filter(Boolean), max = Math.max(1, Math.floor(secs * 2.5)); return w.length <= max ? w.join(' ') : w.slice(0, max).join(' ').replace(/[,;:–—-]+$/, '') + '…'; };
  R.words = words;

  // "Preset: Deep calm male" / "Clone: my-sample" -> a spoken-tone phrase for Kling dialogue tags
  R.toneFrom = voiceName => {
    const v = String(voiceName || '').replace(/^(preset|clone)\s*:\s*/i, '').trim().toLowerCase();
    return v ? v + (/voice/.test(v) ? '' : ' voice') : 'natural, conversational voice';
  };

  // The output ratio of Kling image-to-video FOLLOWS THE INPUT IMAGE (no ratio parameter), so stills must be made at the target ratio.
  R.stillAspect = (model, target) => {
    const m = R.MODELS[model];
    if (m.aspects.includes(target)) return target;
    if (target === '4:5') return m.aspects.includes('3:4') ? '3:4' : '1:1';
    return m.aspects.includes('9:16') ? '9:16' : m.aspects[0];
  };

  /* ---------- hooks (from short-form ad research: problem / result / confession / curiosity / POV) ---------- */
  R.hooks = function (format, c) {
    const p = (c.product || c.concept || 'this').trim(), niche = (c.creator && c.creator.niche) || 'this';
    // every hook is <= 7 words so it fits a 3-second opening beat at a natural pace
    if (format === 'ugc') return [
      `I didn't expect this to work.`,
      `Stop wasting money on this.`,
      `POV: you finally found the fix.`,
      `I was wrong about ${niche}.`,
      `Nobody tells you this.`
    ];
    if (format === 'story') return [
      `It started with one message.`,
      `Nobody believed me. Until last night.`,
      `Three days ago, everything was normal.`,
      `I should have left.`
    ];
    return [`Wait for it.`, `You won't believe what happens next.`];
  };

  /* ---------- default script beats: what we SEE / what they SAY / seconds ---------- */
  R.defaultBeats = function (format, c, total) {
    total = Math.min(15, Math.max(6, total || 15));
    const n = (c.creator && c.creator.name) || 'the creator', prod = c.product || 'the product';
    if (format === 'ugc') {
      const hook = 3, cta = 3, mid = total - hook - cta;
      return [
        { see: `Close selfie-style shot, ${n} looks straight into the camera holding ${prod}, handheld, natural window light`, say: R.hooks('ugc', c)[0], secs: hook },
        { see: `${n} shows ${prod} in use — quick close-up of the key benefit, then back to the camera`, say: c.concept ? fit(cap(c.concept), mid) : `Here's what it actually does for me.`, secs: mid },
        { see: `${n} smiles at the camera and holds ${prod} up`, say: fit(c.cta || `Link is in my bio.`, cta), secs: cta }
      ];
    }
    if (format === 'story') {
      const a = Math.round(total * 0.3), b = Math.round(total * 0.4), z = total - a - b;
      return [
        { see: `Setup: establish the place and ${n}; slow push-in, moody light`, say: R.hooks('story', c)[0], secs: a },
        { see: `The turn: something unexpected happens; camera tightens on ${n}'s reaction`, say: c.concept ? fit(cap(c.concept), b) : '', secs: b },
        { see: `Payoff: the reveal lands; hold on ${n}, then a slow pull-back`, say: '', secs: z }
      ];
    }
    return [{ see: c.concept || 'Absurd, high-energy scene, fast motion, bold colours', say: '', secs: Math.min(total, 8) }];
  };

  /* ---------- prompt formulas ---------- */
  // Kling 3.0 — ONE shot. Order: scene, character, action + dialogue, camera, progression. Image-to-video: never re-describe looks.
  R.klingShot = function (beat, c, o) {
    o = o || {};
    const label = `[Character A: ${(c.creator && c.creator.name) || 'Creator'}`;
    const parts = [];
    parts.push(cap(beat.see.replace(/\.$/, '')) + '.');
    if (beat.say && beat.say.trim()) parts.push(`${label}, ${R.toneFrom(c.creator && c.creator.voiceName)}]: "${beat.say.trim().replace(/"/g, "'")}"`);
    if (o.tail) parts.push(o.tail);
    return clip(parts.join(' '), 512);
  };

  // Whole-clip prompt (used when a single prompt is better than multi_prompt) — Kling reads up to 2,500 characters.
  R.klingWhole = function (beats, c) {
    const lines = beats.map((b, i) => `Shot ${i + 1} (${b.secs}s): ${R.klingShot(b, c)}`);
    return clip(lines.join('\n') + '\nClean footage, natural skin texture, no subtitles, no watermarks, no logos added.', 2500);
  };

  // Seedance 2.0 — refer to assets as "Image 1 / Video 1 / Audio 1" and state what each one supplies.
  R.seedancePrompt = function (o) {
    const s = [];
    if (o.imageCount) s.push(`${o.name || 'The creator'} is the person in ${o.imageCount > 1 ? `Images 1–${o.imageCount}` : 'Image 1'}; maintain their exact face, hair, skin tone and body${o.outfit ? `, wearing ${o.outfit}` : ''}.`);
    if (o.video) s.push(`${o.name || 'The creator'} performs the movement and pacing shown in Video 1. Borrow the motion and the shot structure only — do not copy the original person, face or clothing.`);
    if (o.audio === 'lipsync') s.push('Use Audio 1 as the soundtrack: lip-sync the mouth and time gestures and cuts to its beat and lyrics. Do not change or replace the audio.');
    if (o.scene) s.push(cap(o.scene.replace(/\.$/, '')) + '.');
    if (o.camera) s.push(o.camera);
    s.push('Same character, consistent outfit, natural anatomy, stable face. Clean footage, no subtitles or watermarks.');
    return clip(s.join(' '), 2500);
  };

  // Still image (Grok edit with reference photos, or Soul 2 text-only)
  R.stillPrompt = function (c, o) {
    o = o || {};
    const cr = c.creator, bits = [];
    const style = (c.style || '').replace(/^Recommended:\s*/, '').toLowerCase();
    if (o.refs) bits.push(`Photorealistic ${style || 'candid photo'}. The person is the same individual as in the reference photos — keep the exact face, skin tone, hair and body`);
    else {
      const subject = cr ? [[cr.ethnicity, cr.gender === 'female' ? 'woman' : 'man'].filter(Boolean).join(' '), cr.age && 'aged ' + cr.age, cr.bodyType && cr.bodyType.toLowerCase() + ' build', cr.profession].filter(Boolean).join(', ') : 'a person';
      bits.push(`Photorealistic ${style || 'candid photo'} of ${subject}`);
    }
    if (o.scene) bits.push('Scene: ' + o.scene.replace(/\.$/, ''));
    if (c.wardrobe && c.wardrobe.length) bits.push('Wearing: ' + c.wardrobe.map(w => w.name + (w.desc ? ` (${w.desc})` : '')).join(' and '));
    if (c.background) bits.push('Setting: ' + c.background.name + (c.background.desc ? `, ${c.background.desc}` : ''));
    if (c.accessories && c.accessories.length) bits.push((o.holding ? 'Holding / featuring: ' : 'Props: ') + c.accessories.map(a => a.name + (a.desc ? ` (${a.desc})` : '')).join(', '));
    if (o.framing) bits.push(o.framing);
    if (c.notes) bits.push(c.notes);
    bits.push('Natural skin texture, realistic lighting, sharp focus, no text, no watermark');
    return clip(bits.join('. '), 1800);
  };

  /* ---------- plans ---------- */
  // Reference photos we can send (data URLs from the library). Grok takes up to 10.
  R.collectRefs = function (c) {
    const list = [];
    ((c.creator && c.creator.faceRefs) || []).slice(0, 5).forEach((src, i) => list.push({ key: 'face' + i, label: `${c.creator.name} — photo ${i + 1}`, src, role: 'face' }));
    (c.wardrobe || []).forEach((w, i) => { if (w.img) list.push({ key: 'w' + i, label: w.name, src: w.img, role: 'outfit' }); });
    if (c.background && c.background.img) list.push({ key: 'bg', label: c.background.name, src: c.background.img, role: 'setting' });
    (c.accessories || []).forEach((a, i) => { if (a.img) list.push({ key: 'a' + i, label: a.name, src: a.img, role: 'prop' }); });
    return list.slice(0, 10);
  };

  const step = (o) => Object.assign({ status: 'planned', cost: null }, o);

  // -> { steps:[...], errors:[...], warnings:[...], approxUsd:number|null, unknown:boolean }
  R.plan = function (format, d, c, opt) {
    opt = opt || {};
    const errors = [], warnings = [], steps = [];
    const cr = c.creator, aspect = format === 'photo' ? (d.aspect || '4:5') : '9:16';
    const total = Math.min(15, Math.max(4, parseInt(d.duration, 10) || 15));
    const soulId = R.soulIdFor(c);
    // a Soul ID replaces the reference photos for stills: Soul 2 takes the id, and Kling animates that still
    const viaSoul = !!soulId && !!R.SOUL_FIELD.soul2 && ['photo', 'ugc', 'story', 'brainrot'].includes(format);
    const refs = viaSoul ? [] : R.collectRefs(c);
    const faces = refs.filter(r => r.role === 'face').length;
    if (!cr) errors.push('Pick a creator.');
    else if (!faces && !viaSoul) warnings.push(`${cr.name} has no reference photos, so the face can't be held consistent. Add 3–5 photos (front, side, three-quarter) in the creator's profile.`);
    else if (faces && faces < 3) warnings.push('Best consistency comes from 3–5 reference photos at different angles — you have ' + faces + '.');
    if (refs.length) steps.push(step({ id: 'refs', type: 'refs', label: 'Upload reference photos', items: refs.map(r => ({ key: r.key, label: r.label, role: r.role })) }));
    const useRefs = refs.length > 0;

    const stillModel = useRefs ? 'grok' : 'soul2';
    const stillN = format === 'photo' ? Math.max(1, Math.min(4, parseInt(d.count, 10) || 1)) : (opt.stillCandidates || 2);
    const mkStill = (scene, holding) => step({
      id: 'still', type: 'image', label: format === 'photo' ? 'Photos' : 'Choose the starting frame', model: stillModel, n: stillN, gate: format === 'photo' ? 'keep' : 'pick',
      params: stillModel === 'grok' ? { aspect_ratio: R.stillAspect('grok', aspect), quality: 'medium', resolution: '1k' } : { aspect_ratio: R.stillAspect('soul2', aspect), resolution: '720p', batch_size: 1, soulId: viaSoul ? soulId : undefined },
      prompt: R.stillPrompt(c, { refs: useRefs, scene, holding, framing: aspect === '9:16' ? 'Vertical framing, subject centred with room above the head, phone-camera look' : '' })
    });

    if (format === 'photo') {
      if (!d.concept || !d.concept.trim()) errors.push('Describe the scene.');
      steps.push(mkStill(d.concept, false));
    } else if (format === 'ugc' || format === 'story' || format === 'brainrot') {
      const beats = (d.beats && d.beats.length ? d.beats : R.defaultBeats(format, Object.assign({}, c, { concept: d.concept, product: d.product, cta: d.cta }), total)).map(b => ({ see: b.see || '', say: b.say || '', secs: parseInt(b.secs, 10) || 3 }));
      const sum = beats.reduce((a, b) => a + b.secs, 0);
      if (!d.concept || !d.concept.trim()) errors.push(format === 'brainrot' ? 'Describe the concept.' : 'Add the concept / angle.');
      if (sum > 15) errors.push(`The beats add up to ${sum}s but one Kling clip is at most 15s.`);
      if (sum < 3) errors.push('The beats add up to less than 3s (the shortest clip).');
      if (beats.length > 6) errors.push('Kling takes at most 6 shots per clip.');
      beats.forEach((b, i) => {
        const budget = R.wordBudget(b.secs);
        if (b.say && words(b.say) > budget) warnings.push(`Beat ${i + 1}: ${words(b.say)} words won't fit ${b.secs}s (about ${budget} max) — the speech would be rushed or cut. Shorten it or give the beat more time.`);
        if (b.see.length > 380) warnings.push(`Beat ${i + 1}: the description is long; Kling reads only 512 characters per shot.`);
      });
      const first = beats[0];
      steps.push(mkStill(first.see, format === 'ugc'));
      const sound = beats.some(b => b.say.trim()) || format !== 'brainrot' ? 'on' : 'off';
      const shotPrompts = beats.map(b => ({ prompt: R.klingShot(b, c), duration: b.secs }));
      const vparams = { duration: Math.max(3, sum), sound, cfg_scale: 0.5, multi_shots: beats.length > 1, multi_prompt: beats.length > 1 ? shotPrompts : undefined, loop: !!d.loop };
      const wholePrompt = beats.length > 1 ? `${R.klingShot({ see: beats[0].see, say: '' }, c)} Multi-shot sequence follows the shot list.` : R.klingShot(beats[0], c);
      steps.push(step({ id: 'video', type: 'video', label: 'Draft clip', model: 'klingStd', needs: 'still', gate: 'review', params: vparams, prompt: wholePrompt, beats }));
      steps.push(step({ id: 'final', type: 'video', label: 'Final clip (higher quality)', model: 'klingPro', needs: 'still', gate: 'review', optional: true, params: Object.assign({}, vparams), prompt: wholePrompt, beats }));
    } else if (format === 'sing') {
      if (!d.audioFile && d.audioMode !== 'trend') errors.push('Add the song / audio.');
      if (d.audioMode === 'trend') errors.push('Trending sounds can’t be fetched by the app — upload the audio file instead (the free workaround: export the sound and upload it).');
      const clipSecs = Math.min(15, Math.max(4, Math.round((d.audioFile && d.audioFile.secs) || total)));
      if (d.audioFile && d.audioFile.secs > 15) warnings.push(`Only the first ${clipSecs}s of the track are used (Seedance takes up to 15s of audio).`);
      steps.push(step({ id: 'prepaudio', type: 'audio', label: 'Prepare the audio (WAV, ≤15s)', secs: clipSecs }));
      const scene = [d.concept, d.style && d.style.replace(/^Recommended:\s*/, '')].filter(Boolean).join('. ');
      const prompt = R.seedancePrompt({ name: cr && cr.name, imageCount: Math.min(9, refs.length), audio: 'lipsync', scene, camera: 'Steady medium shot, slight push-in on the chorus.' });
      const p = { aspect_ratio: aspect, duration: clipSecs, generate_audio: false };
      steps.push(step({ id: 'video', type: 'video', label: 'Draft (480p)', model: 'seedRef', gate: 'review', params: Object.assign({ resolution: '480p' }, p), prompt, uses: ['refs', 'audio'] }));
      steps.push(step({ id: 'final', type: 'video', label: 'Final (1080p)', model: 'seedRef', gate: 'review', optional: true, params: Object.assign({ resolution: '1080p' }, p), prompt, uses: ['refs', 'audio'] }));
    } else if (format === 'copy') {
      if (!d.refVideo) errors.push('Add the video you want to copy (MP4, 2–15s).');
      else if (!(d.refVideo.secs > 0)) errors.push('Couldn’t read that video’s length — is it a valid MP4? Try exporting it again.');
      else {
        if (d.refVideo.type && d.refVideo.type !== 'video/mp4') errors.push('Higgsfield takes MP4 video only. Convert this file to MP4 first.');
        if (d.refVideo.secs && (d.refVideo.secs < 2 || d.refVideo.secs > 15)) errors.push(`The reference video is ${Math.round(d.refVideo.secs)}s — it must be 2–15s. Trim it first.`);
        if (d.refVideo.size && d.refVideo.size > 200e6) errors.push('The reference video is over 200 MB.');
      }
      const secs = Math.min(15, Math.max(4, Math.round((d.refVideo && d.refVideo.secs) || total)));
      if (d.audioMode === 'original') steps.push(step({ id: 'prepaudio', type: 'audio', label: 'Take the original audio from the video', secs, fromVideo: true }));
      const prompt = R.seedancePrompt({ name: cr && cr.name, imageCount: Math.min(9, refs.length), video: true, audio: d.audioMode === 'original' ? 'lipsync' : null, outfit: (c.wardrobe || []).map(w => w.name).join(' and '), scene: d.notes || '' });
      const p = { aspect_ratio: aspect, duration: secs, generate_audio: d.audioMode !== 'original' };
      steps.push(step({ id: 'reftovideo', type: 'upload-video', label: 'Upload the video to copy' }));
      steps.push(step({ id: 'video', type: 'video', label: 'Draft copy (480p)', model: 'seedRef', gate: 'review', params: Object.assign({ resolution: '480p' }, p), prompt, uses: ['refs', 'refvideo'].concat(d.audioMode === 'original' ? ['audio'] : []) }));
      steps.push(step({ id: 'final', type: 'video', label: 'Final copy (1080p)', model: 'seedRef', gate: 'review', optional: true, params: Object.assign({ resolution: '1080p' }, p), prompt, uses: ['refs', 'refvideo'].concat(d.audioMode === 'original' ? ['audio'] : []) }));
      if (!refs.length) errors.push('Copying needs the creator’s reference photos (Seedance needs at least one image or video, and the photos carry the face).');
    }

    // rough price preview (list prices; exact numbers come from the estimate endpoint before every spend)
    let approx = 0, unknown = false;
    steps.forEach(s => {
      if (s.optional || !s.model) return;
      const m = R.MODELS[s.model];
      if (m.kind === 'image') approx += (m.approx.image || 0) * (s.n || 1);
      else if (m.approx.sec != null) approx += m.approx.sec * (s.params.duration || 5);
      else unknown = true;
    });
    return { steps, errors, warnings, approxUsd: Math.round(approx * 100) / 100, unknown };
  };

  /* ---------- request bodies (built at run time) ---------- */
  // rt: { refUrls:[...urls in ref order], stillUrl, refVideoUrl, audioUrl }
  R.buildBody = function (s, rt) {
    const m = R.MODELS[s.model], p = s.params || {};
    if (m.kind === 'image') {
      if (s.model === 'grok') { const b = { prompt: s.prompt, quality: p.quality || 'medium', resolution: p.resolution || '1k', aspect_ratio: p.aspect_ratio || 'auto' }; if (rt.refUrls && rt.refUrls.length) b.image_urls = rt.refUrls.slice(0, 10); return b; }
      const b = { prompt: s.prompt, aspect_ratio: p.aspect_ratio || '9:16', resolution: p.resolution || '720p', batch_size: p.batch_size || 1 };
      if (p.soulId && R.SOUL_FIELD.soul2) b[R.SOUL_FIELD.soul2] = p.soulId; // saved Soul ID instead of reference photos
      return b;
    }
    if (s.model === 'seedRef') {
      const b = { prompt: s.prompt, duration: p.duration, resolution: p.resolution || '720p', aspect_ratio: p.aspect_ratio || '9:16', generate_audio: p.generate_audio !== false };
      if (rt.refUrls && rt.refUrls.length) b.image_urls = rt.refUrls.slice(0, 9);
      if (rt.refVideoUrl) b.video_urls = [rt.refVideoUrl];
      if (rt.audioUrl) b.audio_urls = [rt.audioUrl];
      return b;
    }
    // Kling image-to-video
    const b = { prompt: s.prompt, image_url: rt.stillUrl, duration: p.duration };
    if (m.sound) b.sound = p.sound || 'on';
    if (s.model !== 'klingTurbo') b.cfg_scale = p.cfg_scale != null ? p.cfg_scale : 0.5;
    if (s.model === 'klingTurbo') b.resolution = p.resolution || '720p';
    if (p.multi_shots && p.multi_prompt) { b.multi_shots = true; b.multi_prompt = p.multi_prompt.map(x => ({ prompt: x.prompt, duration: x.duration })); }
    if (p.loop && rt.stillUrl && s.model !== 'klingTurbo') b.last_image_url = rt.stillUrl; // seamless loop: end on the starting frame
    return b;
  };

  /* ---------- the playbook shown in the app ---------- */
  R.PLAYBOOK = {
    sources: [
      ['Higgsfield API docs — requests, billing, uploads, models', 'https://docs.higgsfield.ai/docs/llms.txt'],
      ['Kling 3.0 prompting guide (fal.ai)', 'https://blog.fal.ai/kling-3-0-prompting-guide/'],
      ['Seedance 2.0 reference guide (Magic Hour)', 'https://magichour.ai/blog/seedance-20-reference-guide'],
      ['TikTok UGC hook research (Zeely / Stackmatix / Hustler)', 'https://zeely.ai/blog/hooks-for-tiktok-video-ads/'],
      ['AI disclosure rules per platform (Influencer Marketing Hub)', 'https://influencermarketinghub.com/ai-disclosure-rules/'],
      ['Higgsfield AI review: credit costs, iteration rates (AI Funnel Insider)', 'https://aifunnelinsider.com/higgsfield-ai-review-2026/']
    ],
    principles: [
      ['Never pay twice', 'Every job is priced with Higgsfield’s free estimate first, and a submit is never auto-repeated after an unclear failure (the API has no duplicate protection). Failed and moderated jobs are not charged.'],
      ['Draft cheap, finish expensive', 'Pick the still first (cents), animate a draft, and only pay for the higher-quality final on takes you would post. Reviewers report 3–5 tries per usable clip — drafts keep that affordable.'],
      ['The image is the anchor', 'Kling image-to-video keeps the face and layout from the starting frame and has no aspect-ratio setting, so the still is made vertical and the prompt only describes how the scene evolves.'],
      ['Label characters, bind speech to action', '[Character A: Name, voice tone]: "line" — one consistent label, no pronouns. Speech is written for about 2.5 words a second.'],
      ['Land the promise in 3 seconds', 'Beat 1 names the problem or the result. Test 3 hooks over the same body when a video is worth it.'],
      ['Reference photos carry identity', '3–5 photos at different angles. Photos work everywhere; a Soul ID you trained on higgsfield.ai is sent instead where the model accepts one.'],
      ['Label AI content', 'Realistic AI people/voices must be labelled on TikTok, YouTube (“altered or synthetic”) and Instagram (“AI info”). The post kit reminds you.'],
      ['Save results at once', 'Higgsfield keeps outputs for ~7 days. Finished files are downloaded into Files automatically.']
    ],
    formats: {
      ugc: { goal: 'A creator sells a product in a native-feeling 15s clip.', flow: 'Reference photos → 2 stills (creator holding the product) → pick one → Kling 3.0 multi-shot draft with speech → optional Pro final.', why: 'Kling 3.0 makes speech, lip-sync and ambience in one pass and takes up to 6 shots, so hook / proof / call-to-action is a single 15s generation.' },
      story: { goal: 'A 15s narrated mini-story with a twist.', flow: 'Stills → pick → Kling multi-shot (setup / turn / payoff) with narration → final.', why: 'Multi-shot keeps the character and scene continuous; the payoff shot is prompted last.' },
      brainrot: { goal: 'Absurd, fast, loopable shorts.', flow: 'Cheapest still model → Kling draft. “Loop” ends the clip on the first frame.', why: 'Low cost per attempt matters most; retention comes from the loop and pace.' },
      sing: { goal: 'The creator performs to a song.', flow: 'Reference photos + audio (≤15s WAV) → Seedance 2.0 reference-to-video at 480p draft → 1080p final.', why: 'Seedance takes audio references and lip-syncs to them; the audio must come with a visual reference.' },
      photo: { goal: 'Post-ready stills of the creator.', flow: 'Reference photos + scene → Grok Imagine 2.0 edit (1–4 candidates).', why: 'Grok accepts up to 10 reference photos, which is how the face is held.' },
      copy: { goal: 'Recreate a viral video with your creator.', flow: 'Your video (MP4, 2–15s) + creator photos [+ original audio] → Seedance 2.0 reference-to-video draft → final.', why: 'Seedance takes a reference video for motion and pacing. Uploading is free; you pay per second of the video generated.' }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = R; else root.CSRecipes = R;
})(typeof window !== 'undefined' ? window : globalThis);
