/* Tests for the copy-to-Claude prompts (js/formats.js).   node tools/test-prompts.js */
const assert = require('assert');
global.window = global; global.CS = {};
window.CSRecipes = require('../js/recipes.js'); require('../js/formats.js');
const F = CS.FORMATS;
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); } };

const face = 'data:image/jpeg;base64,AAAA';
const mk = over => Object.assign({ name: 'Zayn', gender: 'male', ethnicity: 'South Asian', bodyType: 'Lean athletic', age: '20s-30s', profession: 'reviewer', niche: 'car tech', voiceName: 'Preset: Deep calm male', faceRefs: [face, face, face], locked: true, soulId: '', soulTrained: false }, over || {});
const ctx = cr => ({ creator: cr, brand: null, wardrobe: [], background: null, accessories: [] });
const draft = fid => Object.assign(CS.blankDraft(fid), { concept: 'stopped my phone flying off the dash', product: 'GripMount', cta: 'link in bio', url: 'https://tiktok.com/x', audioMode: F[fid].audio[0] || '', audioFile: { name: 'song.mp3', duration: '12s' }, audioText: 'sound', count: '2', duration: '15' });
const build = (fid, cr) => F[fid].build(draft(fid), ctx(cr));
const SOUL = "Use the Higgsfield Soul ID character named 'zayn-soul-01' for this creator — do not re-describe or regenerate their identity.";
const MODEL = { ugc: [/Soul 2 with the Soul ID/, /Kling 3\.0 Standard image-to-video/], story: [/Soul 2 with the Soul ID/, /Kling 3\.0/], brainrot: [/Soul 2 with the Soul ID/, /Kling 3\.0/], sing: [/Seedance 2\.0 \(reference to video\)/, /Soul 2/], copy: [/Seedance 2\.0 \(reference to video\)/, /Soul 2/], photo: [/Model: Soul 2 with the Soul ID/] };

console.log('with a Soul ID');
for (const fid of Object.keys(F)) t(fid + ': names the models and the Soul ID, no photo-attach instruction', () => {
  const p = build(fid, mk({ soulId: ' zayn-soul-01 ' }));
  assert.ok(p.includes(SOUL), 'soul sentence'); MODEL[fid].forEach(re => assert.match(p, re));
  assert.ok(!/Attach the \d+ reference photo/.test(p));
  assert.ok(!/soul-01\s+'/.test(p));
});
console.log('without a Soul ID (fallback to reference photos)');
for (const fid of Object.keys(F)) t(fid + ': asks for the photos, no Soul ID sentence', () => {
  const p = build(fid, mk());
  assert.ok(!/Soul ID character named/.test(p)); assert.match(p, /Attach the 3 reference photos of Zayn/);
  if (fid === 'sing' || fid === 'copy') assert.match(p, /Seedance 2\.0 \(reference to video\)/); else if (fid === 'photo') assert.match(p, /Model: Grok Imagine 2\.0 with the reference photos/); else assert.match(p, /Grok Imagine 2\.0 with the reference photos.*Kling 3\.0/s);
});
t('no soul id and no photos: asks for photos first', () => assert.match(build('ugc', mk({ faceRefs: [] })), /no reference photos saved — ask me to attach photos/));
t('unlocked creator with a soul id still gets the soul sentence', () => assert.ok(build('ugc', mk({ locked: false, soulId: 'zayn-soul-01' })).includes(SOUL)));
t('no creator: still builds (Brain Rot allows none)', () => assert.match(build('brainrot', null), /Creator: none/));
t('no API key anywhere in the prompt path', () => { global.CS.produce = undefined; assert.doesNotThrow(() => build('ugc', mk({ soulId: 'a' }))); });

console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
