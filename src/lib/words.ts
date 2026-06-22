import type { ApiWord, LanguageCode } from '../types';

/** A word's definition in the user's native language (first letter capitalized),
 *  or undefined when no native translation is loaded for that language (es only
 *  today — other languages omit `translations`, so the (i) info button hides). */
export function nativeDefinition(
  w: ApiWord,
  language: LanguageCode | undefined,
): string | undefined {
  if (!language) return undefined;
  const def = w.translations?.[language]?.[0]?.definition;
  if (!def) return undefined;
  return def.charAt(0).toUpperCase() + def.slice(1);
}
