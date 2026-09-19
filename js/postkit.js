/* Post kit: caption + hashtags + title for every platform, saved next to the video as a .txt.
   Rule-based (no AI call), so it is instant, free and predictable. Limits come from 2026 platform guidance:
   - TikTok:   caption up to 4,000, but only ~100–150 characters show before "more"; 150–300 is the sweet spot;
               keyword in the first ~80 characters; 3–5 hashtags.
   - Instagram: hashtags capped at 5 (Dec 2025) — 3–5 specific ones, at the end; the caption text does the SEO work.
   - YouTube Shorts: title 30–40 chars works best (front-load the keyword); first ~100 chars of the description show;
               3–5 hashtags, #Shorts first.
   - Labels:   realistic synthetic people / voices must be labelled — TikTok "AI-generated", YouTube "Altered or synthetic
               content", Instagram "AI info". The kit reminds you and adds a plain "AI-generated" note to captions. */
(function (root) {
  const K = {};
  const STOP = new Set('a an and are as at be but by for from has have i in into is it its me my of on or our so that the their this to was we with you your just really very about after before when what which who how why'.split(' '));

  const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 30);
  const tag = s => { const t = slug(s); return t.length >= 3 ? '#' + t : ''; };
  const uniq = arr => Array.from(new Set(arr.filter(Boolean)));
  const trim = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; return s.slice(0, n).replace(/\s+\S*$/, '').replace(/[,;:\-–—\s]+$/, '') + '…'; };
  const sentence = s => { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  const end = s => { s = String(s || '').trim(); return s && !/[.!?…]$/.test(s) ? s + '.' : s; };
  const seedPick = (arr, seed) => arr[Math.abs(seed | 0) % arr.length];

  // the 1–3 words that name the thing (used for keyword-first captions and titles)
  K.keyword = function (o) {
    const src = o.product || o.concept || '';
    const w = src.split(/[^A-Za-z0-9'’-]+/).filter(x => x && !STOP.has(x.toLowerCase()));
    return (w.slice(0, 3).join(' ') || (o.creator && o.creator.niche) || 'this').trim();
  };

  const BASE_TAGS = {
    ugc: { all: ['#review', '#musthave', '#honestreview'], tiktok: ['#tiktokmademebuyit'] },
    story: { all: ['#storytime', '#plottwist', '#shortstory'] },
    brainrot: { all: ['#brainrot', '#funny', '#absurd'] },
    sing: { all: ['#lipsync', '#singing', '#aisong'] },
    photo: { all: ['#lifestyle', '#aiinfluencer', '#photodump'] },
    copy: { all: ['#trend', '#viral', '#trending'] }
  };

  K.hashtags = function (o, platform) {
    const niche = o.creator && o.creator.niche, brand = o.brand && o.brand.name;
    // product tag = the last two meaningful words ("phone holder" -> #phoneholder), not the whole phrase
    const brandWords = new Set(String(brand || '').toLowerCase().split(/\s+/));
    const pw = K.keyword(o).split(' ').filter(w => !brandWords.has(w.toLowerCase()));
    const productTag = tag(pw.slice(-2).join('')) || tag(pw.slice(-1).join(''));
    const set = BASE_TAGS[o.format] || { all: [] };
    let out = uniq([tag(brand), productTag, tag(niche)].concat(set.all, platform === 'tiktok' ? (set.tiktok || []) : []));
    // drop a tag that merely contains another one we already have (#gripmount / #gripmountholder)
    out = out.filter((t, i) => !out.some((u, j) => j < i && (t.toLowerCase().includes(u.toLowerCase()) || u.toLowerCase().includes(t.toLowerCase()))));
    if (platform === 'shorts') out = ['#Shorts'].concat(out);
    return out.slice(0, 5);
  };

  const HOOK_LINES = {
    ugc: ['I didn’t expect this to work as well as it did.', 'The one thing I wish I’d found sooner.', 'Honest first impressions — no edits.', 'This changed my daily routine.'],
    story: ['You won’t see the ending coming.', 'Wait for the last second.', 'Some things you can’t unsee.', 'Watch until the end.'],
    brainrot: ['Don’t ask. Just watch.', 'This is what my brain does at 3am.', 'Wait for it…', 'Chaos, but make it art.'],
    sing: ['Turn the volume up.', 'On repeat all week.', 'Sing it with me.', 'This one’s for the fans.'],
    photo: ['Little moments, big mood.', 'Caught in the wild.', 'Today’s mood.', 'Golden hour never misses.'],
    copy: ['My take on the trend.', 'Everyone’s doing it — so did I.', 'Tried the trend. Thoughts?', 'Trend check ✅']
  };
  const CTA_LINES = { ugc: 'Link in bio.', story: 'Follow for part 2.', brainrot: 'Follow for more chaos.', sing: 'Follow for more.', photo: 'Save this for later.', copy: 'Follow for more trends.' };

  K.build = function (o) {
    o = o || {}; o.format = o.format || 'ugc';
    const seed = o.seed != null ? o.seed : (String(o.concept || o.product || '').length * 7 + 3);
    const kw = K.keyword(o), name = (o.creator && o.creator.name) || '';
    const hook = o.hook && o.hook.trim() ? sentence(o.hook.trim()) : seedPick(HOOK_LINES[o.format] || HOOK_LINES.ugc, seed);
    const cta = o.cta && o.cta.trim() ? sentence(o.cta.trim()) : (CTA_LINES[o.format] || 'Follow for more.');
    const detail = o.concept ? sentence(trim(o.concept, 110)) : '';
    const aiNote = o.disclose === false ? '' : '(AI-generated)';

    // TikTok: keyword within the first ~80 chars, whole caption in the 150–300 sweet spot
    const tkTags = K.hashtags(o, 'tiktok');
    const lead = o.format === 'ugc' ? `${sentence(kw)} — ${hook}` : hook;
    let tk = [lead, detail && end(detail), end(cta), aiNote].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const at = tk.toLowerCase().indexOf(kw.toLowerCase());
    if (at < 0 || at > 80) tk = `${sentence(kw)}: ${tk}`;
    tk = trim(tk, 300);
    const tiktok = { caption: tk, hashtags: tkTags, full: `${tk} ${tkTags.join(' ')}`.trim() };

    // Instagram: hook first line, then detail, then hashtags at the end (max 5)
    const igTags = K.hashtags(o, 'reels');
    const ig = [hook, detail && end(detail), end(cta)].filter(Boolean).join('\n\n') + (aiNote ? `\n\n${aiNote}` : '');
    const reels = { caption: ig, hashtags: igTags, full: `${ig}\n\n${igTags.join(' ')}`.trim() };

    // YouTube Shorts: short front-loaded title, description whose first ~100 chars carry the point, #Shorts first
    const ytTags = K.hashtags(o, 'shorts');
    const title = trim(o.format === 'ugc' ? `${sentence(kw)}: honest take` : `${sentence(kw)} — ${hook.replace(/[.!…]+$/, '')}`, 40);
    const desc = [trim(`${hook} ${end(detail)}`.trim(), 100), '', end(cta), aiNote, '', ytTags.join(' ')].filter((x, i, a) => x || (i > 0 && a[i - 1])).join('\n').trim();
    const shorts = { title, description: desc, hashtags: ytTags, full: `${title}\n\n${desc}` };

    const alt = `${name ? name + ', an AI-generated person, ' : 'AI-generated scene: '}${trim(o.concept || o.product || kw, 110)}.`;
    const disclosure = [
      'TikTok: turn on “AI-generated content” when posting.',
      'YouTube: answer Yes to “Altered or synthetic content” (a realistic AI person or voice needs it).',
      'Instagram: apply the “AI info” label (it may also be added automatically).'
    ];
    const notes = [
      'Keep hashtags to 3–5 — more no longer helps.',
      'Put the first spoken line on screen as text: most viewers start with sound off.',
      'Post at the time your audience is active, and reply to early comments.'
    ];
    return { tiktok, reels, shorts, alt, disclosure, notes };
  };

  // The .txt that travels next to the video
  K.toText = function (kit, meta) {
    meta = meta || {};
    const L = [];
    L.push(`POST KIT${meta.title ? ' — ' + meta.title : ''}`, `Made ${meta.date || ''} · AI-generated video: label it on every platform.`.trim(), '');
    L.push('=== TikTok ===', 'Caption:', kit.tiktok.caption, '', 'Hashtags: ' + kit.tiktok.hashtags.join(' '), 'Before posting: ' + kit.disclosure[0], '');
    L.push('=== Instagram Reels ===', 'Caption:', kit.reels.caption, '', 'Hashtags: ' + kit.reels.hashtags.join(' '), 'Before posting: ' + kit.disclosure[2], '');
    L.push('=== YouTube Shorts ===', 'Title: ' + kit.shorts.title, 'Description:', kit.shorts.description, '', 'Before posting: ' + kit.disclosure[1], '');
    L.push('=== Alt text ===', kit.alt, '', '=== Tips ===', ...kit.notes.map(n => '- ' + n));
    return L.join('\n') + '\n';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = K; else root.CSKit = K;
})(typeof window !== 'undefined' ? window : globalThis);
