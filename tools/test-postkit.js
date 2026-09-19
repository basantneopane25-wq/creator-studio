/* Tests for js/postkit.js.   node tools/test-postkit.js */
const assert = require('assert');
const K = require('../js/postkit.js');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); } };

const ugc = { format: 'ugc', product: 'GripMount phone holder', concept: 'stopped my phone flying off the dash on bumpy roads', cta: 'link in bio', creator: { name: 'Zayn', niche: 'car tech' }, brand: { name: 'GripMount' } };

t('keyword: names the thing, skips filler words', () => { assert.strictEqual(K.keyword(ugc), 'GripMount phone holder'); assert.strictEqual(K.keyword({ concept: 'the best of the day' }), 'best day'); });
t('hashtags: 3–5, valid, unique, no spaces', () => {
  for (const p of ['tiktok', 'reels', 'shorts']) { const h = K.hashtags(ugc, p); assert.ok(h.length >= 3 && h.length <= 5, p + ' ' + h.length); assert.ok(h.every(x => /^#[A-Za-z0-9]{3,30}$/.test(x)), h.join()); assert.strictEqual(new Set(h.map(x => x.toLowerCase())).size, h.length); }
});
t('hashtags: #Shorts comes first on YouTube only', () => { assert.strictEqual(K.hashtags(ugc, 'shorts')[0], '#Shorts'); assert.ok(!K.hashtags(ugc, 'tiktok').includes('#Shorts')); });
t('tiktok caption: keyword up front, inside the 300-char ceiling, labelled AI', () => {
  const k = K.build(ugc); assert.ok(k.tiktok.caption.length <= 300); assert.ok(k.tiktok.caption.toLowerCase().indexOf('gripmount') < 30); assert.match(k.tiktok.caption, /AI-generated/);
});
t('shorts title is short and front-loaded; description opens with the point', () => {
  const k = K.build(ugc); assert.ok(k.shorts.title.length <= 40, k.shorts.title.length + ' ' + k.shorts.title); assert.match(k.shorts.title, /^GripMount/); assert.ok(k.shorts.description.split('\n')[0].length <= 101);
});
t('instagram caption: hook first line, hashtags at the end, at most 5', () => {
  const k = K.build(ugc); assert.ok(k.reels.full.trim().endsWith(k.reels.hashtags[k.reels.hashtags.length - 1])); assert.ok(k.reels.hashtags.length <= 5);
});
t('disclosure can be turned off for non-realistic content, but the reminders stay in the kit', () => {
  const k = K.build(Object.assign({}, ugc, { disclose: false })); assert.ok(!/AI-generated\)/.test(k.tiktok.caption)); assert.strictEqual(k.disclosure.length, 3);
});
t('every format produces a kit; empty input does not crash', () => {
  for (const f of ['ugc', 'story', 'brainrot', 'sing', 'photo', 'copy']) { const k = K.build({ format: f, concept: 'test scene' }); assert.ok(k.tiktok.caption && k.shorts.title && k.reels.caption); }
  assert.ok(K.build({}).tiktok.caption);
});
t('deterministic for the same input, varies with a different seed', () => {
  const a = K.build(Object.assign({}, ugc, { seed: 1 })).tiktok.caption, b = K.build(Object.assign({}, ugc, { seed: 1 })).tiktok.caption, c = K.build(Object.assign({}, ugc, { seed: 2 })).tiktok.caption;
  assert.strictEqual(a, b); assert.notStrictEqual(a, c);
});
t('the .txt contains all three platforms, the label reminders and alt text', () => {
  const txt = K.toText(K.build(ugc), { title: 'UGC ad', date: '2026-09-19' });
  ['=== TikTok ===', '=== Instagram Reels ===', '=== YouTube Shorts ===', 'AI-generated content', 'Altered or synthetic', 'AI info', '=== Alt text ==='].forEach(s => assert.ok(txt.includes(s), 'missing ' + s));
});
t('unsafe characters never leak into hashtags', () => { const h = K.hashtags({ format: 'ugc', product: 'Café Ñandú!! 50%', creator: { niche: 'A/B testing' } }, 'tiktok'); assert.ok(h.every(x => /^#[a-z0-9]+$/.test(x)), h.join()); });

console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
