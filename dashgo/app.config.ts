import { ExpoConfig, ConfigContext } from 'expo/config'

/**
 * Build guard: refuse to ship without a valid live Stripe key in production.
 *
 * If the EAS build profile is `production`, the publishable key MUST be a
 * non-empty `pk_live_*` value. We reject:
 *   - undefined / missing key
 *   - empty string key
 *   - test keys (pk_test_*)
 *   - any other prefix that is not pk_live_
 *
 * Throwing here fails the build loudly instead of shipping a checkout
 * surface that cannot tokenize cards (or worse, ships sandbox credentials).
 *
 * Keyed on EAS_BUILD_PROFILE, NOT on NODE_ENV: EAS bundles EVERY release
 * build (preview included) with NODE_ENV=production, and the preview
 * profile intentionally carries a pk_test key against staging — checking
 * NODE_ENV made preview builds fail in the Bundle JavaScript phase.
 *
 * Note: at runtime we ALSO guard inside RootLayout (_layout.tsx) — that
 * catches cases the build-time check misses (e.g., EAS secret revoked
 * between build and OTA update, or non-EAS build paths).
 */
function assertProductionStripeKey() {
  const isProd = process.env.EAS_BUILD_PROFILE === 'production'
  const key = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
  if (!isProd) return

  if (!key || key === '' || !key.startsWith('pk_live_')) {
    const detail = !key
      ? 'is missing/undefined'
      : key === ''
        ? 'is empty'
        : key.startsWith('pk_test_')
          ? 'is a Stripe TEST key (pk_test_*)'
          : `does not start with pk_live_ (got: ${key.slice(0, 8)}…)`
    throw new Error(
      '[dashgo] Refusing to build for production: ' +
        `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ${detail}. ` +
        'Set a live key (pk_live_*) — typically via an EAS secret — before building.',
    )
  }
}

/**
 * Versioning strategy — single source of truth
 * ---------------------------------------------
 *
 * `version` (semver, user-visible):
 *   Source of truth = git release tags (e.g. `v1.2.3`).
 *   Bumped by the release engineer when cutting a release branch/tag.
 *   At build time, EAS reads this string and ships it as
 *   CFBundleShortVersionString (iOS) / versionName (Android).
 *   Both App Store Connect and EAS Update expect strict semver.
 *
 * `ios.buildNumber` (CFBundleVersion, App Store unique-per-upload):
 *   Source of truth = EAS remote version service.
 *   eas.json sets `"autoIncrement": true` for the production profile, so
 *   EAS bumps and persists the next buildNumber on every `eas build`.
 *   The literal `'1'` below is ONLY a local-dev placeholder for
 *   `expo prebuild` / `expo run:ios`. It is OVERRIDDEN at build time by:
 *     1. `process.env.EAS_BUILD_NUMBER` when EAS injects it, or
 *     2. EAS's own native-project mutation during the build.
 *
 * `android.versionCode` (Play Store monotonically-increasing integer):
 *   Same pattern as buildNumber — managed by EAS autoIncrement, with the
 *   literal `1` as a local-dev fallback. Overridden by
 *   `process.env.EAS_BUILD_VERSION_CODE` at EAS build time.
 *
 * Why this matters:
 *   - Apple REJECTS duplicate buildNumbers on a given version. A hardcoded
 *     `'1'` across multiple TestFlight uploads is the #1 cause of rejected
 *     submissions. Letting EAS own the counter eliminates that class of bug.
 *   - Play Store similarly rejects duplicate versionCodes per package.
 *   - Keeping `version` in source (and tied to git tags) means OTA updates
 *     via EAS Update can target the right runtime version channel.
 */
function resolveIosBuildNumber(): string {
  // appVersionSource is 'local' (eas.json) — the build number comes from here.
  // EAS_BUILD_NUMBER is still honored if injected; otherwise use the explicit
  // value below. BUMP THIS by 1 before each App Store/TestFlight upload —
  // Apple rejects a duplicate buildNumber on the same version (1.0).
  const fromEas = process.env.EAS_BUILD_NUMBER
  if (fromEas && fromEas.length > 0) return fromEas
  return '9'
}

function resolveAndroidVersionCode(): number {
  // EAS injects EAS_BUILD_VERSION_CODE for production Android builds when
  // autoIncrement is enabled. Must be a positive integer.
  const fromEas = process.env.EAS_BUILD_VERSION_CODE
  if (fromEas && fromEas.length > 0) {
    const parsed = Number.parseInt(fromEas, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 1
}

export default ({ config }: ConfigContext): ExpoConfig => {
  assertProductionStripeKey()

  return {
    ...config,
    name: 'dashgo',
    slug: 'dashgo',
    // Semver — bump when cutting a release tag (e.g. `git tag v1.0.1`).
    // EAS Update + App Store both require strict semver here. Apple closes a
    // version train once it's approved (error 90186), so every App Store
    // upload after a release MUST carry a higher version than the live one.
    version: '1.0.2',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'dashgo',
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: 'com.dashgo.app',
      // Managed by EAS autoIncrement (see eas.json). The '1' here is a
      // local-dev placeholder only — never trusted for App Store uploads.
      buildNumber: resolveIosBuildNumber(),
      // Phone-only app — disabling tablet support keeps the App Store
      // review surface small and prevents iPad screenshot requirements.
      supportsTablet: false,
      // Lock to full-screen so multitasking layouts don't break our
      // bottom-sheet flows on iPad-class devices.
      requireFullScreen: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Udash uses your location to auto-select the nearest saved delivery address at checkout.',
        // Stripe's SDK references the camera API (card scanning), so Apple
        // requires a purpose string even though the cash-only launch does not
        // actively use the camera. Without it, processing rejects with
        // ITMS-90683 (missing NSCameraUsageDescription).
        NSCameraUsageDescription:
          'Udash uses the camera to scan payment cards at checkout when paying by card.',
        // expo-secure-store can gate the keychain behind biometrics. Keep a
        // clear, non-generic string so App Review does not flag a placeholder.
        NSFaceIDUsageDescription:
          'Udash uses Face ID to keep your session securely signed in.',
        // Skip the export-compliance prompt on every TestFlight build.
        // Udash uses only Apple's standard HTTPS — no custom crypto.
        ITSAppUsesNonExemptEncryption: false,
        // Ensure the home-screen label reads "Udash", not the lowercase slug.
        CFBundleDisplayName: 'Udash',
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#000000',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      package: 'com.dashgo.app',
      // Managed by EAS autoIncrement (see eas.json). The `1` here is a
      // local-dev placeholder only — never trusted for Play Store uploads.
      versionCode: resolveAndroidVersionCode(),
      permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      [
        'expo-router',
        {
          root: './src/app',
        },
      ],
      [
        'expo-splash-screen',
        {
          // UDash navy — matches the monogram splash icon so it blends.
          backgroundColor: '#021229',
          android: {
            image: './assets/images/splash-icon.png',
            imageWidth: 76,
          },
        },
      ],
      [
        '@stripe/stripe-react-native',
        {
          // No merchantIdentifier on purpose → no Apple Pay capability/
          // entitlement is generated. Cash-only launch with card payments
          // gated; Apple Pay is not offered. Re-add the merchant id here when
          // Apple Pay is enabled.
          enableGooglePay: false,
        },
      ],
      'expo-secure-store',
      // Remote push (order tracking + win-back). Adds the iOS aps-environment
      // entitlement at prebuild; EAS manages the APNs key in the cloud. The
      // backend sends through the Expo Push API (see dashgo-api PushService).
      'expo-notifications',
      // Sentry config plugin. Wires the native iOS / Android crash reporter
      // into prebuild. Source maps and dSYMs are uploaded automatically when
      // SENTRY_AUTH_TOKEN is present in the EAS build environment. With no
      // token the plugin still installs the native module — JS errors are
      // captured, native symbolication just isn't uploaded.
      //
      // We deliberately do NOT pass `setUser` or any identifying option. The
      // mobile app's Apple privacy manifest declares "Not Linked" data
      // collection; identifying the user to Sentry would contradict that.
      '@sentry/react-native/expo',
      // Copies assets/PrivacyInfo.xcprivacy into the iOS app target's
      // Resources build phase. Required by Apple since May 2024.
      //
      // Migration note (Expo SDK 55):
      // SDK 55 exposes `ios.privacyManifests` as a first-party config field
      // that auto-generates the .xcprivacy. We deliberately keep the custom
      // plugin for now because:
      //   1. We need fine control over both NSPrivacyAccessedAPITypes AND
      //      NSPrivacyCollectedDataTypes (incl. PaymentInfo via Stripe SDK).
      //   2. The hand-written xcprivacy is checked into source and reviewed
      //      by the App Store team — regenerating from config on every build
      //      makes diffs noisier and harder to audit.
      //   3. The custom plugin guards against double-registration on prebuild
      //      re-runs and produces deterministic Xcode project changes.
      // Revisit once SDK 55's native field supports all of the above without
      // surprises in CI.
      './plugins/withPrivacyManifest',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      eas: {
        projectId: '4a871bfe-e7dc-4fee-8ccb-5b18ab8ad3b2',
      },
    },
  }
}
