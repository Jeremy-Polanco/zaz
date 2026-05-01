# zaz (mobile)

App mobile de Zaz. Expo 55 · React Native · NativeWind · TanStack Query.

> Setup del stack completo (docker, seed, envs): ver [../README.md](../README.md).

## Stack

- **Expo 55** + **Expo Router** (file-based, typed routes)
- **React Native 0.83** + React 19 (new architecture habilitada)
- **NativeWind 4** + **Tailwind v3** (Tailwind v4 aún no soportado estable en NativeWind)
- **TanStack Query** + `@react-native-async-storage/async-storage` para persist
- **react-hook-form** + **Zod**
- **Stripe React Native** (setup inicial)
- **Inter Tight** single-font system (ver [Design](#design-system))

## Rutas (Expo Router)

```
src/app/
├── _layout.tsx                       # QueryClientProvider, StripeProvider, fonts
├── index.tsx                         # redirect por rol
├── (auth)/
│   └── login.tsx                     # phone + OTP, acepta ?ref=code
├── r/
│   └── [code].tsx                    # landing de referral (deep link)
├── (tabs)/                           # CLIENT
│   ├── _layout.tsx
│   ├── index.tsx                     # catálogo con chips de categorías + offers
│   ├── orders.tsx                    # mis pedidos
│   ├── points.tsx                    # balance + timeline
│   └── profile.tsx
├── (promoter)/                       # PROMOTER
│   ├── _layout.tsx
│   ├── index.tsx                     # dashboard
│   ├── commissions.tsx
│   ├── payouts.tsx
│   └── profile.tsx
├── (super)/                          # SUPER_ADMIN_DELIVERY
│   ├── _layout.tsx
│   ├── index.tsx                     # Ruta — pedidos activos con Maps/Waze
│   ├── categories.tsx
│   ├── products.tsx                  # CRUD global + category picker + offers
│   ├── promoters/
│   │   ├── index.tsx                 # listado + invitar
│   │   └── [id].tsx                  # detalle + "Pagar ahora"
│   └── profile.tsx
├── checkout.tsx                      # carrito + toggle puntos
└── orders/
    └── [orderId]/
        └── invoice.tsx               # factura con Share.share()
```

Paridad con web: cada pantalla del web tiene su contraparte mobile.

## Auth flow

Igual al web — phone + OTP:

1. `/(auth)/login` → ingresa teléfono → `POST /auth/otp/send`
2. Pantalla OTP de 6 dígitos → `POST /auth/otp/verify` (opcional `fullName` y `referralCode` desde `?ref` o `r/[code]`)
3. Tokens en `AsyncStorage`
4. `src/app/index.tsx` redirige: `client → (tabs)` · `promoter → (promoter)` · `super_admin_delivery → (super)`

## Deep linking

- **Referral landing:** `zaz://r/ABC12DEF` o `https://zaz.app/r/ABC12DEF` → `src/app/r/[code].tsx` → precarga promotor via `usePromoterByCode`, pasa código al login.

Scheme: `zaz`. Configurado en `app.json` + `StripeProvider.urlScheme="zaz"`.

## Data layer

Todo en [src/lib/queries.ts](src/lib/queries.ts), paridad exacta con web:

```ts
useProducts() · useCategories()
usePointsBalance() · usePointsHistory()
usePromoterDashboard() · useMyPromoterStats()
useCreatePayout()         // super admin
useInvoice(orderId)
```

API URL se resuelve en orden:
1. `app.json → extra.apiUrl`
2. `EXPO_PUBLIC_API_URL`

En device físico usar IP LAN (`http://192.168.1.20:3002/api`) — `localhost` apunta al device, no al host.

## Design system

**Inter Tight single-font** con NativeWind. Weights disponibles via `tailwind.config.js`:

```ts
font-sans           // InterTight_400Regular
font-sans-medium    // InterTight_500Medium
font-sans-semibold  // InterTight_600SemiBold
font-sans-bold      // InterTight_700Bold
font-sans-italic    // InterTight_500Medium_Italic
```

Las fonts se cargan en [src/app/_layout.tsx](src/app/_layout.tsx) con `useFonts` + `SplashScreen.preventAutoHideAsync()` para evitar FOUT.

Paleta Planeta Azul idéntica a web: `paper`, `ink`, `accent`, `ok`, `warn`, `bad`. Eyebrows con `uppercase tracking-eyebrow`, tabular nums via `style={{ fontVariant: ['tabular-nums'] }}` donde haga falta.

## Dev

```bash
cp env.example .env
npm install
npm run ios                       # o npm run android
```

Si cambiás fonts o rutas, borrar cache:

```bash
rm -rf .expo/types node_modules/.cache
npx expo start --clear
```

## Gotchas

- **Expo Router sibling conflict:** no podés tener `promoters.tsx` Y `promoters/` al mismo nivel. Convención: si hay `[id].tsx` anidado, usar `promoters/index.tsx` para el listado.
- **Typed routes:** después de cambios de rutas, regenerar con `rm -rf .expo/types` y reiniciar `npx expo start`.
- **OTP input sin mono font:** el OTP de 6 dígitos en login usa `font-sans` con `tracking-[8px]`. Si querés columnas perfectas, agregá `style={{ fontVariant: ['tabular-nums'] }}`.
- **Referral code display:** mismo caso que OTP — Inter Tight no es monospaced, se compensa con tracking generoso.
- **New Architecture:** habilitada por default en SDK 53+. Algunas libs viejas pueden romper — chequear docs antes de sumar deps.
- **Stripe key:** se lee de `app.json → extra.stripePublishableKey`. No commitear la live key.
