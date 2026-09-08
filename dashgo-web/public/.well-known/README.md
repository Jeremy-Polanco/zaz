# `/.well-known` — universal links & app links

These two files let `https://www.dashgo.dev/r/<CODE>` open the **Udash app**
instead of the web landing when the app is installed. They are served as static
assets from `public/` (the SPA catch-all rewrite in `vercel.json` skips any path
containing a dot, so `.well-known` is never swallowed by `index.html`).

## ⚠️ `www` only — never the apex

`dashgo.dev` **307-redirects** to `www.dashgo.dev` at the Vercel domain level,
and neither Apple nor Android follows redirects when fetching these files. So
only `www.dashgo.dev` can ever validate, and it is the only host declared in the
app (`ios.associatedDomains` / `android.intentFilters` in `dashgo/app.config.ts`).

That is consistent with what actually gets shared: promoter links are built from
`PUBLIC_WEB_URL`, which is `https://www.dashgo.dev` in production (DEPLOYMENT.md).

If someone removes the apex→www redirect in the Vercel dashboard, add
`dashgo.dev` back to both lists in `app.config.ts` and cut a new native build.

## iOS — `apple-app-site-association`

Ready to ship. No extension on purpose; `vercel.json` adds
`Content-Type: application/json`, which Apple requires.

- Team ID: `3K7TM3DZBB`
- Bundle id: `com.dashgo.app`
- Matched paths: `/r/*`

Verify after deploy:

```bash
curl -sI https://www.dashgo.dev/.well-known/apple-app-site-association | grep -i content-type
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
