// Poll App Store Connect for the processing state of a build.
// Uses the App Store Connect API key (ES256 JWT). No external deps.
//
// Usage: node asc-build-status.mjs <appAppleId> <buildVersion> [--watch]
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'

const APP_ID = process.argv[2]
const BUILD_VERSION = process.argv[3] // CFBundleVersion, e.g. "2"
const WATCH = process.argv.includes('--watch')

const KEY_ID = '6W7RA3ZT6U'
const ISSUER_ID = '81cdf633-2d13-4c6b-8b4c-6fa7f4349ade'
const P8_PATH = `${os.homedir()}/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

function makeJWT() {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(
    JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 1000, aud: 'appstoreconnect-v1' }),
  )
  const signingInput = `${header}.${payload}`
  const key = crypto.createPrivateKey(fs.readFileSync(P8_PATH, 'utf8'))
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${b64url(sig)}`
}

async function fetchBuild() {
  const jwt = makeJWT()
  const url = `https://api.appstoreconnect.apple.com/v1/builds?filter[app]=${APP_ID}&limit=10&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`API ${res.status}: ${t.slice(0, 300)}`)
  }
  const json = await res.json()
  return (json.data || []).find((b) => b.attributes.version === BUILD_VERSION) || null
}

async function once() {
  const b = await fetchBuild()
  if (!b) return { state: 'NOT_FOUND' }
  return { state: b.attributes.processingState, uploaded: b.attributes.uploadedDate }
}

if (WATCH) {
  // Poll until VALID/INVALID/FAILED, up to ~40 minutes.
  for (let i = 0; i < 80; i++) {
    let r
    try {
      r = await once()
    } catch (e) {
      console.log(`[poll ${i}] error: ${e.message}`)
      await new Promise((res) => setTimeout(res, 30000))
      continue
    }
    console.log(`[poll ${i}] build ${BUILD_VERSION} → ${r.state}`)
    if (r.state === 'VALID') {
      console.log('=====BUILD_READY===== build is processed and ready for TestFlight/review')
      process.exit(0)
    }
    if (r.state === 'INVALID' || r.state === 'FAILED') {
      console.log('=====BUILD_INVALID===== Apple rejected the build at processing (check email)')
      process.exit(2)
    }
    await new Promise((res) => setTimeout(res, 30000))
  }
  console.log('=====TIMEOUT===== still processing after ~40min')
  process.exit(1)
} else {
  console.log(JSON.stringify(await once()))
}
