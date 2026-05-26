# Maestro mobile e2e

Flows that drive the DashGo mobile app on a real iOS simulator or Android emulator.

## Prerequisites

1. **Maestro CLI** — installed via `brew install mobile-dev-inc/tap/maestro --formula`.
   Verify: `maestro --version` returns `2.x.x`.

2. **Backend** — `dashgo-api` running on `localhost:3002` with a fresh seed.
   ```bash
   POSTGRES_HOST_PORT=5434 API_HOST_PORT=3002 \
     docker compose --env-file /dev/null up -d postgres api
   docker exec dashgo-api npm run seed
   ```
   The login flow tails `docker logs dashgo-api` to read the dev-mode OTP, so
   the api container must be named `dashgo-api`.

3. **Simulator / Emulator** with the **DashGo dev build** installed.
   - iOS: `cd dashgo && eas build --profile development --platform ios`, then
     install the resulting `.app` to the simulator.
   - Android: same with `--platform android`.
   - The bundle id is `com.dashgo.app` (set in `app.config.ts`). Maestro keys
     off this.

4. The mobile app's `EXPO_PUBLIC_API_URL` must point at the host's api. For the
   iOS simulator that's `http://localhost:3002/api`. For a physical device or
   Android emulator, use the LAN IP.

## Run

```bash
cd dashgo
maestro test .maestro/login.yaml        # single flow
maestro test .maestro/                   # whole directory
maestro studio .maestro/login.yaml       # interactive inspector
```

## Flows

| File | Tags | What it does |
|---|---|---|
| `brand.yaml` | brand, smoke | Confirms the login screen renders DashGo branding and has no legacy ZAZ/Bodeguita/Colmapp leakage. |
| `login.yaml` | auth, smoke | Full OTP login: phone → send → read dev OTP from api logs → verify → assert routed past login. |
| `invalid-otp.yaml` | auth, error | Submits a wrong code, asserts the inline error renders without crashing. |

## How OTP is solved

DashGo's `dashgo-api` logs the dev OTP to stdout for any `+1 555-555-xxxx`
phone (Twilio bypass). The `login.yaml` flow shells out to
`docker logs dashgo-api` via `scripts/read-otp.js`, parses the code, and
injects it into the code field.

This works only when the api container is named `dashgo-api` and is on the
same host as the Maestro runner.

## CI notes

These flows are written for a developer laptop with a simulator. To run them
in CI you need a macOS runner with Xcode + an iOS simulator booted (or
equivalent for Android). GitHub Actions' macOS runners support this but it's
slow and we don't currently wire it.

## testIDs

Flows use `testID` attributes added in `src/app/(auth)/login.tsx`:

- `login-phone-input` — phone TextInput
- `login-send-code-btn` — "Enviar código" submit
- `login-code-input` — 6-digit OTP TextInput
- `login-verify-btn` — "Verificar" submit

Add more testIDs (and matching flows) for cycle 5 surfaces — rental detail
PENDING_SETUP badge, mixed-cart checkout guard, monthly disclosure — when the
related screens stabilize.
