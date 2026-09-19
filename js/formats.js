/* Content formats. Each format is plain data + a build() that turns the Create form into a prompt.
   To add a new kind of video, add one entry to CS.FORMATS — the Create screen, queue and dashboard pick it up automatically. */
(function (CS) {
  CS.OPTIONS = {
    platforms: ['TikTok', 'Instagram Reels', 'YouTube Shorts'],
    durations: ['15', '30', '45', '60'],
    aspects: ['4:5', '1:1', '9:16', '16:9'],
    counts: ['1', '2', '4'],
    hooks: ['Let Claude decide', 'Question', 'Bold claim', 'Visual shock', 'POV', 'Story cliffhanger']
  };

  CS.AUDIO_MODES = {
    new: { label: 'Fresh voiceover', hint: 'Claude writes the lines; spoken in the creator’s saved voice (or new audio if no creator).' },
    trend: { label: 'Trending sound', hint: 'Reuse a viral sound exactly as-is. Cuts and lip-sync follow it.' },
    upload: { label: 'Upload a track', hint: 'An AI song or your own audio. The file isn’t stored — attach it in the chat.' },
    original: { label: 'Original audio', hint: 'Use the source video’s exact audio; the creator lip-syncs and acts to it.' }
  };

  /* ---------- prompt building blocks ---------- */
  const soulOf = cr => (cr && typeof cr.soulId === 'string' ? cr.soulId.trim() : '');
  // Which models to use (names come from recipes.js so the two never disagree)
  function modelLine(fid, c) {
    const M = window.CSRecipes.MODELS, cr = c.creator, soul = !!soulOf(cr), photos = !!(cr && (cr.faceRefs || []).length);
    const still = soul ? `${M.soul2.label} with the Soul ID` : photos ? `${M.grok.label.replace(/ \(.*/, '')} with the reference photos` : `${M.soul2.label} (text prompt)`;
    if (fid === 'photo') return `Model: ${still}.`;
    if (fid === 'sing' || fid === 'copy') {
      const refs = soul ? `first make a still of the Soul ID character with ${M.soul2.label} and use it as Image 1` : 'use the attached reference photos as Images 1+';
      return `Model: ${M.seedRef.label} — ${refs}. Draft at 480p, final at 1080p only for the take I approve.`;
    }
    return `Models: starting stills with ${still}; animate with ${M.klingStd.label} image-to-video (${M.klingPro.label} only for the final).`;
  }

  function castBlock(d, c, noVoice) {
    const cr = c.creator;
    if (!cr) return 'Creator: none — no fixed identity needed unless the concept calls for one.';
    const lines = [`Creator: ${cr.name} — ${[cr.gender, cr.ethnicity, cr.bodyType, cr.age].filter(Boolean).join(', ')}`];
    if (cr.profession || cr.niche) lines.push(`Persona: ${cr.profession || ''}${cr.niche ? ' · ' + cr.niche : ''}`);
    const soulId = soulOf(cr), photos = (cr.faceRefs || []).length;
    lines.push(soulId
      ? `Identity: Use the Higgsfield Soul ID character named '${soulId}' for this creator — do not re-describe or regenerate their identity.`
      : photos
        ? `Identity: no Soul ID saved. Attach the ${photos} reference photo${photos === 1 ? '' : 's'} of ${cr.name} to this chat and use them as image references so the face and body match. Do not invent a new face.`
        : `Identity: no Soul ID and no reference photos saved — ask me to attach photos of ${cr.name} before generating.`);
    if (cr.locked) lines.push('The face, body and overall look are LOCKED — never change them.');
    if (!noVoice) lines.push(d.audioMode === 'new'
      ? `Voice: ${cr.voiceName || '(none set)'} — reuse this saved voice, never generate a new one for them.`
      : `Voice: their saved voice ("${cr.voiceName || 'none set'}") is NOT used in this video.`);
    return lines.join('\n');
  }

  function lookBlock(c) {
    const out = [];
    const nd = x => x.name + (x.desc ? ` (${x.desc})` : '');
    if (c.wardrobe.length) out.push('Outfit: ' + c.wardrobe.map(nd).join(' + '));
    if (c.background) out.push('Background: ' + nd(c.background));
    if (c.accessories.length) out.push('Props / accessories: ' + c.accessories.map(nd).join(', '));
    return out.join('\n');
  }

  const brandBlock = c => (c.brand ? `Brand promo: ${c.brand.name} — ${c.brand.notes || 'no notes'}` : 'No brand promo.');
  const hookLine = d => (d.hook && d.hook !== 'Let Claude decide' ? `Opening hook style: ${d.hook}` : '');
  const cleanStyle = d => d.style.replace(/^Recommended: /, '');
  const styleLine = d => `Style: ${cleanStyle(d)}`;
  const notesLine = (d, label) => (d.notes ? `${label || 'Notes'}: ${d.notes}` : '');
  const outLine = d => `Output: vertical 9:16, about ${d.duration}s, made for ${d.platform}.`;

  function audioBlock(d) {
    switch (d.audioMode) {
      case 'trend': return `Audio: reuse this exact trending audio, do not replace it: ${d.audioText}. Time cuts and any lip-sync to the track's beat/lyrics.`;
      case 'upload': return `Audio: uploaded file "${d.audioFile ? d.audioFile.name : ''}" (${d.audioFile ? d.audioFile.duration : ''}). Attach this exact file in the chat message — it is not stored by the tool. Do not generate new vocals or swap in another track.`;
      case 'original': return 'Audio: use the exact original audio from the source video, unchanged. The creator lip-syncs and acts to it — do not write new dialogue or generate new vocals.';
      default: return 'Audio: write the dialogue / voiceover yourself to fit the concept and pacing, and generate it.';
    }
  }

  // Budget discipline for the Claude + Higgsfield route. (The Higgsfield connector has no spending cap of its own.)
  const BUDGET = 'Budget rules: before EVERY generation tell me the model and its credit cost and wait for my OK; draft with the cheapest suitable model at the lowest resolution first and only make a higher-quality version of the take I approve; stop and ask after 2 failed attempts on the same step. Do not spend more than I approve.';
  // Shot list in Kling 3.0 syntax: scene first, then [Character A: Name, voice tone]: "line" (about 2.5 spoken words per second)
  function shotList(fid, d, c) {
    const R = window.CSRecipes; if (!R) return '';
    const cx = Object.assign({}, c, { concept: d.concept, product: d.product, cta: d.cta });
    const beats = d.beats && d.beats.length ? d.beats : R.defaultBeats(fid, cx, parseInt(d.duration, 10) || 15);
    return 'Shot list (one Kling 3.0 multi-shot clip, max 15s total):\n' + beats.map((b, i) => `  ${i + 1}. (${b.secs}s) ${R.klingShot(b, cx)}`).join('\n');
  }
  const kling = 'Method: 1) make 2 starting stills of the creator (identity exactly as given above; vertical 9:16); wait for my pick. 2) animate the picked still with Kling 3.0 image-to-video (sound on, multi-shot as listed). In image-to-video describe how the scene evolves, do not re-describe how the person looks.';

  const join = arr => arr.filter(Boolean).join('\n');

  /* ---------- formats ---------- */
  CS.FORMATS = {
    ugc: {
      id: 'ugc', icon: '🛍️', label: 'UGC Brand Ad', tagline: 'A creator pitches a product like a friend would.',
      creator: 'required', showLook: true, audio: ['new', 'trend'], product: true, cta: true,
      concept: { label: 'Angle / what the ad shows', required: true, placeholder: 'e.g. "I stopped overpaying for X — here’s what I use instead"' },
      styles: [
        'Recommended: selfie-style talking head, handheld, natural light, casual delivery',
        'Unboxing + demo close-ups with voiceover',
        'Problem → solution split, bold text overlays',
        'Day-in-my-life, product woven into the routine'
      ],
      ideas: [
        'I tried the viral product everyone keeps sending me — honest first impressions',
        '3 reasons I switched and never looked back',
        'POV: you finally found the thing that actually works',
        'Stop doing this one thing every morning (here’s the fix)',
        'Unboxing my order and testing it live, no edits'
      ],
      build: (d, c) => join([
        'UGC BRAND AD',
        castBlock(d, c), lookBlock(c), brandBlock(c),
        d.product && `Product / offer: ${d.product}`,
        `Angle: ${d.concept}`,
        d.cta && `Call to action: ${d.cta}`,
        styleLine(d), hookLine(d), audioBlock(d), notesLine(d),
        modelLine('ugc', c), shotList('ugc', d, c), kling + ' Keep it honest and native-feeling, not a polished commercial.', BUDGET,
        outLine(d)
      ])
    },

    story: {
      id: 'story', icon: '📖', label: 'Story Short', tagline: 'Narrated twist / confessional / mini-drama.',
      creator: 'optional', showLook: true, audio: ['new', 'trend'],
      concept: { label: 'Story concept', required: true, placeholder: 'e.g. a 45-second twist story about a barista who reads minds' },
      styles: [
        'Recommended: cinematic voiceover, slow push-in, text-on-screen hook',
        'POV confessional, handheld',
        'Animated storybook stills + narration'
      ],
      ideas: [
        'A barista who can hear customers’ thoughts — until she hears her own name',
        'The last train home: a stranger knows what I did yesterday',
        'I found a door in my apartment that wasn’t there last week',
        'A retired thief tells the one job he still regrets',
        'Everyone forgot my birthday — except the guy I never met'
      ],
      build: (d, c) => join([
        'STORY SHORT',
        `Concept: ${d.concept}`,
        castBlock(d, c), lookBlock(c), brandBlock(c),
        styleLine(d), hookLine(d), audioBlock(d), notesLine(d),
        modelLine('story', c), shotList('story', d, c), kling + (d.loop ? ' Make it loop: end the clip on its first frame (use the start frame as the last frame).' : ''), BUDGET,
        outLine(d)
      ])
    },

    brainrot: {
      id: 'brainrot', icon: '🤪', label: 'Brain Rot', tagline: 'Absurdist, fast-cut, maximum retention.',
      creator: 'optional', showLook: true, audio: ['new', 'trend'],
      concept: { label: 'Prompt / concept', required: true, placeholder: 'e.g. a raccoon explains crypto to a pigeon, absurdist, fast cuts' },
      styles: [
        'Recommended: chaotic subway-surfer split-screen, high saturation, meme captions',
        'Minimal narrator, single subject, deadpan',
        'Fast-cut collage, stock footage mashup'
      ],
      ideas: [
        'A raccoon explains crypto to a pigeon',
        'Sigma goldfish gives financial advice from inside a bowl',
        'Two skibidi-style toasters argue about who is the main character',
        'A cat CEO fires the entire office for not understanding the algorithm',
        'Lore dump: the origin of the ohio gas station'
      ],
      build: (d, c) => join([
        'BRAIN ROT SHORT',
        `Concept: ${d.concept}`,
        castBlock(d, c), lookBlock(c), brandBlock(c),
        styleLine(d), hookLine(d), audioBlock(d), notesLine(d),
        modelLine('brainrot', c), shotList('brainrot', d, c), 'Method: make a still (the cheapest good image model is fine — no fixed face needed unless a creator is set), then animate it with Kling 3.0 image-to-video, 6-8 seconds, fast cuts.' + (d.loop ? ' Make it loop: end on the first frame.' : ''), BUDGET,
        outLine(d)
      ])
    },

    sing: {
      id: 'sing', icon: '🎤', label: 'Lip-sync / Perform', tagline: 'Your creator performs to a song or viral sound.',
      creator: 'required', showLook: true, audio: ['upload', 'trend'],
      concept: { label: 'Scene / vibe', required: false, placeholder: 'e.g. neon-lit stage, dramatic slow zoom, crowd silhouettes' },
      styles: [
        'Recommended: energetic lip-sync, hand gestures, beat-synced cuts',
        'Calm solo performance, static camera',
        'Duet-style split screen',
        'Dance + lip-sync'
      ],
      ideas: [
        'Late-night studio session, moody backlight, one continuous take feel',
        'Rooftop at golden hour, wind in the hair, slow push-in',
        'Neon stage with fog, beat-synced flash cuts',
        'Car karaoke — passenger seat POV, big emotions'
      ],
      notesLabel: 'Choreography, mood, extra direction',
      build: (d, c) => join([
        'LIP-SYNC / PERFORMANCE VIDEO',
        castBlock(d, c), lookBlock(c), brandBlock(c),
        d.concept && `Scene / vibe: ${d.concept}`,
        audioBlock(d),
        `Performance style: ${cleanStyle(d)}`, hookLine(d), notesLine(d, 'Notes'),
        modelLine('sing', c), 'Method: Seedance 2.0 reference-to-video with the creator as the image reference and this audio as Audio 1 (audio needs a visual reference and is at most 15s). The character lip-syncs and performs to the audio; do not generate new vocals or swap the track. Draft at the lowest resolution first.', BUDGET,
        outLine(d)
      ])
    },

    photo: {
      id: 'photo', icon: '📸', label: 'Influencer Photo', tagline: 'Still pics for posts — make them here or in Higgsfield.',
      creator: 'required', showLook: true, audio: [], image: true,
      concept: { label: 'Scene / what the photo shows', required: true, placeholder: 'e.g. grabbing an iced coffee outside a café, laughing at the camera' },
      styles: [
        'Recommended: candid selfie, natural light',
        'Mirror selfie, outfit check',
        'Lifestyle shot, golden hour, shallow depth of field',
        'Clean studio portrait, soft light',
        'Gym / fitness shot',
        'Travel shot with a scenic backdrop'
      ],
      ideas: [
        'Iced coffee on a café terrace, laughing at something off-camera',
        'Getting ready in the mirror before a night out',
        'Post-workout in the gym, casual and sweaty',
        'Walking through a street market, looking back over the shoulder',
        'Sitting on a rooftop at sunset with a city view',
        'Unboxing a package on the couch, genuinely excited'
      ],
      notesLabel: 'Extra direction (pose, mood, camera angle)',
      // Short text prompt for the in-app generator (no Soul ID here — see the note in the UI)
      imagePrompt: (d, c) => {
        const cr = c.creator;
        const subject = cr
          ? [[cr.ethnicity, cr.gender === 'female' ? 'woman' : 'man'].filter(Boolean).join(' '), cr.age && 'aged ' + cr.age, cr.bodyType && cr.bodyType.toLowerCase() + ' build', cr.profession].filter(Boolean).join(', ')
          : 'a person';
        const bits = [
          `Photorealistic photo, ${cleanStyle(d).toLowerCase()}`,
          `Subject: ${subject}`,
          `Scene: ${d.concept}`,
          c.wardrobe.length ? 'Wearing: ' + c.wardrobe.map(w => w.name + (w.desc ? ' (' + w.desc + ')' : '')).join(' and ') : '',
          c.background ? 'Setting: ' + c.background.name + (c.background.desc ? ', ' + c.background.desc : '') : '',
          c.accessories.length ? 'Props: ' + c.accessories.map(a => a.name).join(', ') : '',
          d.notes,
          'Natural skin texture, realistic lighting, sharp focus, no text, no watermark'
        ];
        return bits.filter(Boolean).join('. ');
      },
      build: (d, c) => join([
        'INFLUENCER PHOTO',
        castBlock(d, c, true), lookBlock(c), brandBlock(c),
        `Scene: ${d.concept}`,
        styleLine(d), notesLine(d), modelLine('photo', c),
        `Method: generate ${d.count} photorealistic still image${d.count === '1' ? '' : 's'} with the creator's identity exactly as given above so face and body match every other post. Natural skin texture, no text or watermarks. Aspect ratio ${d.aspect}. Show me the results before making any more.`, BUDGET,
      ])
    },

    copy: {
      id: 'copy', icon: '🔁', label: 'Copy a Trend', tagline: 'Recreate a viral video with your own creator.',
      creator: 'required', showLook: true, audio: ['original', 'new'], url: true,
      concept: null,
      styles: ['Match the original as closely as the format allows', 'Keep the format, modernise the look', 'Keep the hook, change the punchline'],
      ideas: [],
      notesLabel: 'Anything to change (optional)',
      build: (d, c) => join([
        'RECREATE TREND',
        `Source video: ${d.url}`,
        'Steps for you (Claude): open the link if you can, and analyse the hook, pacing, shot list and audio. If you can’t fetch it directly, ask me to paste the video file or a transcript.',
        castBlock(d, c), lookBlock(c), brandBlock(c),
        audioBlock(d),
        `Approach: ${cleanStyle(d)}.`,
        `Changes requested: ${d.notes || 'none — match the original as closely as the format allows.'}`,
        modelLine('copy', c), `Method: the source video is Video 1 — the MOTION and pacing reference only; the creator (identity as given above) is the person. Keep the source's timing and camera; do not copy the original person's face or clothes.${d.audioMode === 'new' ? ' Deliver new dialogue in the creator\'s voice.' : ''} Draft at the lowest resolution first.`, BUDGET,
        outLine(d)
      ])
    }
  };

  /* ---------- shared logic ---------- */
  CS.blankDraft = fid => {
    const f = CS.FORMATS[fid];
    return {
      concept: '', style: f.styles[0], creatorId: '', wardrobeIds: [], backgroundId: '', accessoryIds: [], brandId: '',
      platform: 'TikTok', duration: '30', hook: 'Let Claude decide',
      audioMode: f.audio[0] || '', aspect: '4:5', count: '1', beats: [], loop: false, refVideo: null, audioText: '', audioFile: null, notes: '', url: '', product: '', cta: ''
    };
  };

  // Resolve ids in a draft to the actual library records.
  CS.buildContext = d => {
    const S = CS.S, pick = (arr, ids) => (ids || []).map(id => arr.find(x => x.id === id)).filter(Boolean);
    return {
      creator: CS.find.creator(d.creatorId),
      brand: CS.find.brand(d.brandId),
      wardrobe: pick(S.wardrobe, d.wardrobeIds),
      background: S.backgrounds.find(b => b.id === d.backgroundId) || null,
      accessories: pick(S.accessories, d.accessoryIds)
    };
  };

  CS.buildPrompt = (fid, d) => CS.FORMATS[fid].build(d, CS.buildContext(d));

  CS.checkDraft = (fid, d) => {
    const f = CS.FORMATS[fid], c = CS.buildContext(d), missing = [], warn = [];
    if (f.concept && f.concept.required && !d.concept.trim()) missing.push('concept');
    if (f.url && !d.url.trim()) missing.push('video link');
    if (f.creator === 'required' && !c.creator) missing.push('a creator');
    if (d.audioMode === 'trend' && !d.audioText.trim()) missing.push('the trending sound');
    if (d.audioMode === 'upload' && !d.audioFile) missing.push('an audio file');
    if (c.creator && !c.creator.locked) warn.push('Creator isn’t locked yet — identity may drift between videos.');
    if (c.creator && d.audioMode === 'new' && !c.creator.voiceName) warn.push('Creator has no saved voice.');
    if (fid === 'ugc' && !c.brand) warn.push('No brand selected — this will be a generic ad.');
    return { missing, warn };
  };
})(window.CS);
