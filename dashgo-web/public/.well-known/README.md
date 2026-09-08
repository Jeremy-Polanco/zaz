# `/.well-known` — universal links & app links

These two files let `https://dashgo.dev/r/<CODE>` open the **Udash app** instead
of the web landing when the app is installed. They are served as static assets
from `public/` (the SPA catch-all rewrite in `vercel.json` skips any path
containing a dot, so `.well-known` is never swallowed by `index.html`).

## iOS — `apple-app-site-association`

Ready to ship. No extension on purpose; `vercel.json` adds
`Content-Type: application/json`, which Apple requires.

- Team ID: `3K7TM3DZBB`
- Bundle id: `com.dashgo.app`
- Matched paths: `/r/*`

Verify after deploy:

```bash
curl -sI https://dashgo.dev/.well-known/apple-app-site-association | grep -i content-type
```

## Android — `assetlinks.json` (⚠️ INCOMPLETE)

`sha256_cert_fingerprints` is intentionally **empty**. Nothing breaks with an
empty array — Android App Links simply will not auto-verify, so `/r/<CODE>` keeps
opening the browser (which still works: the web landing points at `/app`). Fill it
in to get the app to open directly.

Get the fingerprint of the **Play App Signing** key (not the upload key):

- `eas credentials -p android` → select the profile → *Keystore* → copy the
  SHA256 fingerprint, **or**
- Play Console → your app → *Test and release* → *App integrity* → *App signing*
  → "SHA-256 certificate fingerprint".

Then paste it, colons and all:

```json
"sha256_cert_fingerprints": ["AB:CD:…:EF"]
```

Both the upload key and the Play App Signing key can be listed — add the upload
key too if you sideload debug builds. Deploy, then check with Google's tester:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://dashgo.dev&relation=delegate_permission/common.handle_all_urls
```
