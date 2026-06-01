import { ExpoConfig, ConfigContext } from 'expo/config'

/**
 * Runtime guard: refuse to ship without a valid live Stripe key in production.
 *
 * If NODE_ENV === 'production' (EAS production builds set this), the
 * publishable key MUST be a non-empty `pk_live_*` value. We reject:
 *   - undefined / missing key
 *   - empty string key
 *   - test keys (pk_test_*)
 *   - any other prefix that is not pk_live_
 *
 * Throwing here fails the build loudly instead of shipping a checkout
 * surface that cannot tokenize cards (or worse, ships sandbox credentials).
 *
 * Note: at runtime we ALSO guard inside RootLayout (_layout.tsx) — that
 * catches cases the build-time check misses (e.g., EAS secret revoked
 * between build and OTA update).
 */
function assertProductionStripeKey() {
  const isProd = process.env.NODE_ENV === 'production'
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

export default ({ config }: ConfigContext): ExpoConfig => {
  assertProductionStripeKey()

  return {
    ...config,
    name: 'dashgo',
    slug: 'dashgo',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'dashgo',
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: 'com.dashgo.app',
      buildNumber: '1',
      // Phone-only app — disabling tablet support keeps the App Store
      // review surface small and prevents iPad screenshot requirements.
      supportsTablet: false,
      // Lock to full-screen so multitasking layouts don't break our
      // bottom-sheet flows on iPad-class devices.
      requireFullScreen: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'DashGo uses your location to auto-select the nearest saved delivery address at checkout.',
        // Skip the export-compliance prompt on every TestFlight build.
        // DashGo uses only Apple's standard HTTPS — no custom crypto.
        ITSAppUsesNonExemptEncryption: false,
        // Ensure the home-screen label reads "DashGo" (capitalized),
        // not the lowercase slug.
        CFBundleDisplayName: 'DashGo',
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
      versionCode: 1,
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
          backgroundColor: '#000000',
          android: {
            image: './assets/images/splash-icon.png',
            imageWidth: 76,
          },
        },
      ],
      [
        '@stripe/stripe-react-native',
        {
          merchantIdentifier: 'merchant.com.dashgo',
          enableGooglePay: false,
        },
      ],
      'expo-secure-store',
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
    },
  }
}
