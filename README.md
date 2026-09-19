# Creator Studio

A small studio for short-form AI video: cast consistent AI creators, build production-ready prompts, and track every job through to the finished file.

No build step and no backend — open `index.html` or host the folder on any static host (GitHub Pages works as-is). Settings data lives in your browser's local storage (**Settings → Export backup**); pictures and videos live in the browser's IndexedDB and are mirrored to a real phone folder (see *Files* below).

## How it works

1. **Creators** — make a creator (face refs, body, voice), then *lock* it so the identity stays consistent.
2. **Library / Brands** — save outfits, backgrounds, props and sponsor brands once.
3. **Create** — pick a format (UGC ad, story, brain rot, lip-sync, influencer photo, copy a trend), cast a creator, choose the look and sound. The prompt builds live. *Influencer Photo* can also generate pictures right in the app.
4. **Queue** — copy the prompt into a Claude chat with the Higgsfield connector on, then mark the job done with the credits used, and attach the finished video or picture.
5. **Files** — everything you make is filed as `Creator Studio / <Creator> / Pics` and `Vids`.

Nothing here calls Higgsfield directly, so no account credentials are stored.

## Files on your phone

```
Creator Studio/
  Zayn/
    Pics/
    Vids/
  Mira/
    Pics/
    Vids/
```

- **Android / desktop Chrome or Edge:** *Files → Choose folder* once. The app creates the tree above inside it and copies every new file across automatically. After a browser restart, tap *Allow & sync* once (the browser asks again).
- **iPhone Safari / Firefox:** browsers can't write into a folder. Files stay inside the app; use *Save* on any file (→ Save to Files) or *Export as ZIP* (unzips into the same tree).
- Deleting a file in the app never deletes the copy in your phone folder.
- The Settings backup (.json) does **not** contain pictures/videos; the ZIP does.

## Picture generation

*Create → Influencer Photo → Generate here.* Two providers (Settings → Picture generation):

- **Free service** (Pollinations, no account) — one picture at a time, sometimes slow or refused, and it can't keep one face across pictures.
- **Your own key** — any OpenAI-compatible images endpoint. Billed by that provider. The key is stored only in this browser and never written to backups.

For a creator's locked face (Soul ID) and for all videos, copy the prompt into Claude with the Higgsfield connector instead.

## Structure

```
index.html        app shell
css/styles.css    all styles
js/core.js        state store, helpers, modal/toast, hash router
js/formats.js     video formats + prompt builders (add a format = add one entry)
js/create.js      Create studio
js/queue.js       Queue + Home dashboard
js/media.js       photo/video store (IndexedDB) + phone-folder writer + ZIP/share
js/zip.js         tiny ZIP writer (no dependencies)
js/imagegen.js    in-app picture generation providers
js/files.js       Files screen
js/creators.js    Creators list, profile, wizard
js/library.js     Library, Brands, Trends
js/settings.js    Plan / credits / backup
js/app.js         event delegation + boot
sw.js             offline cache (network-first)
```

Routes are hash-based (`#/create/story`, `#/queue`, …). Data saved by earlier versions loads automatically.
