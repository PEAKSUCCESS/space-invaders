import { STRINGS, type StringKey } from './strings';
import { fetchUiStrings } from '../lib/appApi';

// Native-language overrides loaded from the API, keyed like STRINGS. Empty until
// loadUiStrings() resolves; any key not present falls back to the English source.
let overrides: Record<string, string> = {};

export function setTranslations(map: Record<string, string>): void {
  overrides = map ?? {};
}

/** Translate a UI string key, with `{name}` interpolation. Falls back to the
 *  baked-in English default (then the key itself) when nothing is loaded. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = overrides[key] ?? STRINGS[key] ?? key;
  if (params) {
    for (const name in params) {
      s = s.split(`{${name}}`).join(String(params[name]));
    }
  }
  return s;
}

const TIMEOUT_MS = 2500;

/** Fetch + apply the native-language UI strings. No-op for English or on any
 *  error/timeout — the English defaults stay in place. Call once at boot,
 *  before the first render, so strings are ready and there's no English flash. */
export async function loadUiStrings(lang?: string): Promise<void> {
  if (!lang || lang === 'en') return;
  try {
    const map = await Promise.race([
      fetchUiStrings(lang),
      new Promise<Record<string, string>>((_, reject) =>
        setTimeout(() => reject(new Error('ui-strings timeout')), TIMEOUT_MS),
      ),
    ]);
    setTranslations(map);
  } catch {
    /* keep English defaults */
  }
}
