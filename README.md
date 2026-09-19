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


## Making videos inside the app (Higgsfield API)

Optional. **Settings → Make videos inside the app** connects the app to Higgsfield's API so a video goes from idea to saved file without leaving the app:

**Create → Produce in app →** upload reference photos (free) → 2 starting stills → *you pick one* → Kling 3.0 multi-shot draft with speech → *you approve* → saved to **Files** with a caption/hashtag `.txt` next to it → optional higher-quality final. **Download** gives you the video and its caption together.

- **Separate billing.** The API is a prepaid dollar balance (min. $5) and is *not* your Higgsfield plan credits. The plan's "unlimited" windows don't apply to it.
- **Safety.** Every step is priced with Higgsfield's free estimate endpoint first and needs your click (small amounts can auto-approve). Caps per video / day / month. A submit is never auto-repeated after an unclear failure (the API has no duplicate protection). Failed and moderated jobs aren't charged. Reloading the page resumes watching instead of paying again.
- **Keys.** Best: the [proxy](worker/README.md) (key stays on Cloudflare). Direct mode stores the key in this browser's storage — Higgsfield advises against that — and requires you to tick an acknowledgement. Keys are never included in backups.
- **Recipes.** Every format has a researched recipe (models, prompt formulas, checks) — see the in-app **Playbook** for the reasoning and sources.
- **Limits.** Identity comes from reference photos (the API has no Soul ID). Voices are described, not locked. The app can't open TikTok links — upload the MP4 to copy a video.
- **Not the API?** Leave it Off and use **Copy for Claude + Higgsfield**; the prompts include the same shot lists and budget rules. (The Claude connector uses your plan credits but can't be driven from a web page.)

## Tests

No installs needed (Node 18+): `node tools/test-all.js` runs 81 tests — the API client, the recipes, the post kit, the production engine and the proxy — against a mock of the Higgsfield API built from the official docs (`tools/mock-higgsfield.js`). Nothing in the tests spends money. The real service has not been called by these tests; use **Test connection** in Settings (it's free) after adding your key.

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
js/settings.js    Plan / credits / API access / backup
js/higgs.js       Higgsfield API client (pricing, polling, uploads, safety rules)
js/recipes.js     model catalog, prompt formulas, plans per format
js/postkit.js     captions / hashtags / titles per platform
js/factory.js     production engine (steps, spend ledger, resume)
js/produce.js     production screen + browser glue
js/create-ext.js  script editor & plan box on Create
js/playbook.js    the research behind the recipes
worker/           optional Cloudflare proxy (keeps the key off the device)
tools/            mock Higgsfield server + test suites
js/app.js         event delegation + boot
sw.js             offline cache (network-first)
```

Routes are hash-based (`#/create/story`, `#/queue`, …). Data saved by earlier versions loads automatically.
