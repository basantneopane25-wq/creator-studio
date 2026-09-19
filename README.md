# Creator Studio

A small studio for short-form AI video: cast consistent AI creators, build production-ready prompts, and track every job through to the finished file.

No build step and no backend — open `index.html` or host the folder on any static host (GitHub Pages works as-is). Data is stored in your browser's local storage; use **Settings → Export backup** regularly.

## How it works

1. **Creators** — make a creator (face refs, body, voice), then *lock* it so the identity stays consistent.
2. **Library / Brands** — save outfits, backgrounds, props and sponsor brands once.
3. **Create** — pick a format (UGC ad, story, brain rot, lip-sync, copy a trend), cast a creator, choose the look and sound. The prompt builds live.
4. **Queue** — copy the prompt into a Claude chat with the Higgsfield connector on, then mark the job done with the credits used and where the file landed.

Nothing here calls Higgsfield directly, so no account credentials are stored.

## Structure

```
index.html        app shell
css/styles.css    all styles
js/core.js        state store, helpers, modal/toast, hash router
js/formats.js     video formats + prompt builders (add a format = add one entry)
js/create.js      Create studio
js/queue.js       Queue + Home dashboard
js/creators.js    Creators list, profile, wizard
js/library.js     Library, Brands, Trends
js/settings.js    Plan / credits / backup
js/app.js         event delegation + boot
sw.js             offline cache (network-first)
```

Routes are hash-based (`#/create/story`, `#/queue`, …). Data saved by earlier versions loads automatically.
