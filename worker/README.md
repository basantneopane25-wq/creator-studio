# Higgsfield proxy (recommended way to connect)

Higgsfield's docs say **never put an API key in browser code**. This tiny Cloudflare Worker keeps your key on Cloudflare; the app only knows a separate password (the *studio token*).

What it protects: your real Higgsfield key never reaches the browser. What it doesn't: anyone who gets the studio token can still spend your prepaid balance through the proxy — so keep the balance small ($5–$20) and auto top-up off.

## Set it up (about 10 minutes, free tier is enough)

You do these steps yourself (creating accounts and handling keys is not something the app or an assistant should do for you).

1. **Higgsfield API key** — sign in at <https://console.higgsfield.ai>, add a small prepaid balance (minimum $5), create an API key. The secret is shown only once; copy the key ID and the secret.
2. **Cloudflare** — create a free account at <https://dash.cloudflare.com>, then install Wrangler: `npm install -g wrangler` and run `wrangler login`.
3. In this `worker/` folder create `wrangler.toml`:
   ```toml
   name = "studio-proxy"
   main = "higgsfield-proxy.mjs"
   compatibility_date = "2026-01-01"

   [vars]
   ALLOWED_ORIGIN = "https://YOURNAME.github.io"   # your site, exactly, no trailing slash
   ```
4. Add the secrets (each command asks you to paste the value):
   ```bash
   wrangler secret put HF_KEY_ID
   wrangler secret put HF_KEY_SECRET
   wrangler secret put STUDIO_TOKEN     # make this a long random password
   ```
5. `wrangler deploy` — it prints an address like `https://studio-proxy.YOURNAME.workers.dev`.
6. In the app: **Settings → Make videos inside the app → “Through my proxy”**, paste the address and the studio token, then **Test connection (free)**.

## What the proxy allows
Only the calls the app needs: price estimates, generation for the model families the app uses, request status/cancel, file upload, and downloading finished files from Higgsfield/CDN hosts. Everything else is refused. It is tested in `tools/test-proxy.mjs`.

## Rotating
If the token leaks, run `wrangler secret put STUDIO_TOKEN` with a new value and update it in the app. If the Higgsfield key leaks, delete it in the Higgsfield console and put a new one.
