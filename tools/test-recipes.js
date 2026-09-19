/* Tests for js/recipes.js.   node tools/test-recipes.js */
const assert = require('assert');
const { start } = require('./mock-higgsfield');
const { createClient } = require('../js/higgs.js');
const R = require('../js/recipes.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); } }

const face = 'data:image/jpeg;base64,AAAA';
const creator = { name: 'Zayn', gender: 'male', ethnicity: 'South Asian', bodyType: 'Lean athletic', age: '20s-30s', profession: 'car gadget reviewer', niche: 'car tech', voiceName: 'Preset: Deep calm male', faceRefs: [face, face, face] };
const ctx = (over) => Object.assign({ creator, brand: { name: 'GripMount' }, wardrobe: [{ name: 'Black tee', desc: 'fitted', img: face }], background: { name: 'Car interior', desc: 'daytime', img: face }, accessories: [{ name: 'GripMount holder', desc: 'black phone mount', img: face }], style: 'Recommended: selfie-style talking head' }, over || {});
const base = { concept: 'stopped my phone flying off the dash', product: 'GripMount holder', cta: 'Link in bio', duration: '15', aspect: '4:5', count: '2', audioMode: 'new', notes: '' };
const RT = { refUrls: ['https://cdn.x/r1.jpg', 'https://cdn.x/r2.jpg', 'https://cdn.x/r3.jpg'], stillUrl: 'https://cdn.x/still.png', refVideoUrl: 'https://cdn.x/v.mp4', audioUrl: 'https://cdn.x/a.wav' };

(async () => {
  const mock = await start(0, { speed: 0.05 });
  const cl = createClient({ mode: 'direct', baseUrl: mock.url, keyId: 'test', keySecret: 'secret' });
  // every body a recipe produces must pass the (docs-derived) schema check
  const accepts = async (s, extra) => { const body = R.buildBody(s, Object.assign({}, RT, extra)); const e = await cl.estimate(R.MODELS[s.model].id, body); assert.ok(e.usd >= 0); return body; };

  console.log('helpers');
  await t('tone from a saved voice label', () => { assert.strictEqual(R.toneFrom('Preset: Deep calm male'), 'deep calm male voice'); assert.strictEqual(R.toneFrom(''), 'natural, conversational voice'); });
  await t('word budget ~2.5 words per second', () => { assert.strictEqual(R.wordBudget(3), 7); assert.strictEqual(R.wordBudget(15), 37); });
  await t('4:5 maps to a ratio the model supports (Kling i2v follows the still)', () => { assert.strictEqual(R.stillAspect('grok', '4:5'), '3:4'); assert.strictEqual(R.stillAspect('soul2', '9:16'), '9:16'); });
  await t('Kling shot: scene first, tagged dialogue, <=512 chars, quotes made safe', () => {
    const p = R.klingShot({ see: 'Close selfie shot holding the mount', say: 'It "never" falls off', secs: 3 }, ctx());
    assert.match(p, /^Close selfie shot/); assert.match(p, /\[Character A: Zayn, deep calm male voice\]: "It 'never' falls off"/);
    assert.ok(R.klingShot({ see: 'x'.repeat(900), say: '', secs: 3 }, ctx()).length <= 512);
  });

  console.log('plans');
  await t('photo: refs -> stills via Grok with reference photos; body accepted', async () => {
    const pl = R.plan('photo', Object.assign({}, base, { concept: 'iced coffee on a cafe terrace' }), ctx());
    assert.deepStrictEqual(pl.errors, []); assert.deepStrictEqual(pl.steps.map(s => s.id), ['refs', 'still']);
    const still = pl.steps[1]; assert.strictEqual(still.model, 'grok'); assert.strictEqual(still.n, 2); assert.strictEqual(still.params.aspect_ratio, '3:4');
    const b = await accepts(still); assert.strictEqual(b.image_urls.length, 3); assert.match(b.prompt, /same individual as in the reference photos/);
    assert.ok(pl.approxUsd > 0.05 && pl.approxUsd < 0.2, 'approx ' + pl.approxUsd);
  });
  await t('photo without reference photos falls back to Soul 2 text-only and warns', async () => {
    const c = ctx({ creator: Object.assign({}, creator, { faceRefs: [] }), wardrobe: [], background: null, accessories: [] });
    const pl = R.plan('photo', Object.assign({}, base, { concept: 'walking in the market' }), c);
    assert.strictEqual(pl.steps.find(s => s.id === 'still').model, 'soul2'); assert.ok(pl.warnings.some(w => /no reference photos/.test(w)));
    await accepts(pl.steps.find(s => s.id === 'still'));
  });
  await t('ugc: still -> Kling draft (multi-shot, speech) -> optional Pro final; all bodies accepted', async () => {
    const pl = R.plan('ugc', base, ctx()); assert.deepStrictEqual(pl.errors, []);
    assert.deepStrictEqual(pl.steps.map(s => s.id), ['refs', 'still', 'video', 'final']);
    const v = pl.steps.find(s => s.id === 'video'), f = pl.steps.find(s => s.id === 'final');
    assert.strictEqual(v.model, 'klingStd'); assert.strictEqual(f.model, 'klingPro'); assert.strictEqual(f.optional, true);
    const b = await accepts(v); assert.strictEqual(b.multi_shots, true); assert.strictEqual(b.multi_prompt.length, 3);
    assert.strictEqual(b.multi_prompt.reduce((a, s) => a + s.duration, 0), b.duration); assert.ok(b.multi_prompt.every(s => s.prompt.length <= 512));
    assert.match(b.multi_prompt[0].prompt, /\[Character A: Zayn/); assert.strictEqual(b.image_url, RT.stillUrl); assert.strictEqual(b.sound, 'on');
    await accepts(f); assert.ok(pl.approxUsd > 0.3 && pl.approxUsd < 1.5, 'approx ' + pl.approxUsd);
  });
  await t('kling image-to-video has no aspect_ratio parameter (would be refused)', async () => {
    const v = R.plan('ugc', base, ctx()).steps.find(s => s.id === 'video'); assert.ok(!('aspect_ratio' in R.buildBody(v, RT)));
  });
  await t('loop option ends the clip on the first frame', async () => {
    const pl = R.plan('brainrot', Object.assign({}, base, { concept: 'raccoon explains crypto to a pigeon', loop: true }), ctx({ accessories: [] }));
    const b = await accepts(pl.steps.find(s => s.id === 'video')); assert.strictEqual(b.last_image_url, RT.stillUrl); assert.ok(!b.multi_shots);
  });
  await t('speech that cannot fit its shot is flagged before any spend', () => {
    const beats = [{ see: 'a', say: 'This is a really long sentence that certainly cannot be said in three seconds flat', secs: 3 }];
    const pl = R.plan('ugc', Object.assign({}, base, { beats }), ctx()); assert.ok(pl.warnings.some(w => /won't fit 3s/.test(w)));
  });
  await t('beats over 15s / over 6 shots are hard errors', () => {
    const many = Array.from({ length: 7 }, () => ({ see: 'x', say: '', secs: 2 }));
    assert.ok(R.plan('story', Object.assign({}, base, { beats: many }), ctx()).errors.some(e => /at most 6 shots/.test(e)));
    assert.ok(R.plan('story', Object.assign({}, base, { beats: [{ see: 'x', say: '', secs: 12 }, { see: 'y', say: '', secs: 6 }] }), ctx()).errors.some(e => /at most 15s/.test(e)));
  });
  await t('sing: audio prep -> Seedance reference-to-video at 480p draft / 1080p final; audio + photos referenced', async () => {
    const pl = R.plan('sing', Object.assign({}, base, { audioFile: { name: 's.wav', secs: 22 }, concept: 'neon stage', audioMode: 'upload' }), ctx());
    assert.deepStrictEqual(pl.errors, []); assert.ok(pl.warnings.some(w => /first 15s/.test(w)));
    const v = pl.steps.find(s => s.id === 'video'); assert.strictEqual(v.params.resolution, '480p'); assert.strictEqual(pl.steps.find(s => s.id === 'final').params.resolution, '1080p');
    const b = await accepts(v); assert.deepStrictEqual(b.audio_urls, [RT.audioUrl]); assert.strictEqual(b.image_urls.length, 3); assert.strictEqual(b.duration, 15); assert.strictEqual(b.generate_audio, false); assert.match(b.prompt, /Audio 1/);
  });
  await t('sing without audio, or with a trending-sound link, is an error', () => {
    assert.ok(R.plan('sing', Object.assign({}, base, { audioMode: 'upload' }), ctx()).errors.length);
    assert.ok(R.plan('sing', Object.assign({}, base, { audioMode: 'trend', audioText: 'x' }), ctx()).errors.some(e => /upload the audio file/.test(e)));
  });
  await t('copy: reference video + photos -> Seedance; body accepted; rules enforced', async () => {
    const d = Object.assign({}, base, { audioMode: 'original', refVideo: { type: 'video/mp4', secs: 9, size: 5e6 } });
    const pl = R.plan('copy', d, ctx()); assert.deepStrictEqual(pl.errors, []);
    const v = pl.steps.find(s => s.id === 'video'); const b = await accepts(v); assert.deepStrictEqual(b.video_urls, [RT.refVideoUrl]); assert.strictEqual(b.duration, 9); assert.strictEqual(b.generate_audio, false); assert.match(b.prompt, /Video 1/); assert.match(b.prompt, /do not copy the original person/);
    assert.ok(R.plan('copy', Object.assign({}, d, { refVideo: { type: 'video/quicktime', secs: 9 } }), ctx()).errors.some(e => /MP4/.test(e)));
    assert.ok(R.plan('copy', Object.assign({}, d, { refVideo: { type: 'video/mp4', secs: 40 } }), ctx()).errors.some(e => /2–15s/.test(e)));
    assert.ok(R.plan('copy', Object.assign({}, d, { refVideo: { type: 'video/mp4', secs: 0, size: 100 } }), ctx()).errors.some(e => /valid MP4/.test(e)));
    assert.ok(R.plan('copy', Object.assign({}, d, { refVideo: { type: 'video/mp4', secs: 9, size: 300e6 } }), ctx()).errors.some(e => /200 MB/.test(e)));
    assert.ok(R.plan('copy', d, ctx({ creator: Object.assign({}, creator, { faceRefs: [] }), wardrobe: [], background: null, accessories: [] })).errors.some(e => /reference photos/.test(e)));
  });
  await t('no creator is an error; prompts never exceed Kling limits', () => {
    assert.ok(R.plan('ugc', base, ctx({ creator: null })).errors.some(e => /creator/i.test(e)));
    const pl = R.plan('ugc', Object.assign({}, base, { beats: [{ see: 'z'.repeat(2000), say: '', secs: 3 }, { see: 'q', say: '', secs: 3 }] }), ctx()); assert.ok(pl.steps.find(s => s.id === 'video').params.multi_prompt.every(s => s.prompt.length <= 512));
    assert.ok(R.klingWhole(Array.from({ length: 6 }, () => ({ see: 'y'.repeat(500), say: 'hello', secs: 2 })), ctx()).length <= 2500);
  });
  await t('suggested script lines always fit their time, and hooks are short', () => {
    const c = { creator: { name: 'Zayn' }, product: 'GripMount holder', concept: 'stopped my phone flying off the dash on every bumpy road I drive and never once fell', cta: 'Use code SAVE10 today, link in my bio right now' };
    for (const f of ['ugc', 'story']) R.defaultBeats(f, c, 15).forEach((b, i) => { assert.ok(R.words(b.say) <= R.wordBudget(b.secs), `${f} beat ${i + 1}: ${b.say}`); assert.ok(!/\bda h\b/.test(b.say), 'mangled text: ' + b.say); });
    for (const f of ['ugc', 'story', 'brainrot']) R.hooks(f, c).forEach(h => assert.ok(R.words(h) <= 7, 'hook too long: ' + h));
    assert.match(R.defaultBeats('ugc', c, 15)[1].say, /dash on every/); // words are never split or dropped mid-word
  });
  await t('every catalog endpoint id exists on the mock (i.e. matches the documented ids)', () => {
    const { MODELS } = require('./mock-higgsfield'); Object.values(R.MODELS).forEach(m => assert.ok(MODELS[m.id], 'unknown endpoint ' + m.id) || true);
  });

  await mock.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})();
