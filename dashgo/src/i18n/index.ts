/**
 * App-wide i18n (ES/EN). Spanish is the source language — every `es` value is
 * the exact copy the app shipped with (tests assert on it). English mirrors it.
 *
 * Boot: first paint uses the device language (expo-localization); a manually
 * chosen language (Perfil → Idioma) is persisted and restored asynchronously.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import * as Localization from 'expo-localization'
import AsyncStorage from '@react-native-async-storage/async-storage'
import es from './locales/es'
import en from './locales/en'

export const LANGUAGE_KEY = 'dashgo.language.v1'
export type AppLanguage = 'es' | 'en'

const deviceLanguage: AppLanguage =
  Localization.getLocales?.()?.[0]?.languageCode === 'en' ? 'en' : 'es'

void i18n.use(initReactI18next).init({
  resources: { es, en },
  lng: deviceLanguage,
  fallbackLng: 'es',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
})

// Restore the persisted manual choice (async — first paint uses the device
// language, then swaps if the stored preference differs). Fully defensive:
// storage may be unavailable (or mocked without a promise) at module load.
void (async () => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY)
    if ((stored === 'es' || stored === 'en') && stored !== i18n.language) {
      void i18n.changeLanguage(stored)
    }
  } catch {
    // Best-effort restore — the device-language default already applies.
  }
})()

export async function setAppLanguage(lang: AppLanguage): Promise<void> {
  await i18n.changeLanguage(lang)
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang)
  } catch {
    // Persistence is best-effort — the in-memory language already changed.
  }
}

export default i18n
