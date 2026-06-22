import type { AvatarId, LanguageCode } from '../types';
import { avatars } from '../data/avatars';

export interface LaunchParams {
  userId?: number;
  language?: LanguageCode;
  avatarId?: AvatarId;
  userName?: string;   // PLP shopper identity — used to attribute feedback
  userEmail?: string;
}

const SUPPORTED_LANGUAGES: LanguageCode[] = [
  'en', 'ja', 'ko', 'zh', 'es', 'pt', 'fr', 'tl', 'ro', 'hi', 'id', 'th', 'vi', 'ur',
];

export function parseLaunchParams(search: string): LaunchParams {
  const params = new URLSearchParams(search);
  const out: LaunchParams = {};

  // PLP identifies the shopper by their numeric PeakESL id, sent as ?distID=.
  // Accept a few aliases/casings; fall back to VITE_DEV_USER_ID for local dev.
  const rawUser =
    params.get('distID') ?? params.get('distId') ?? params.get('distid') ??
    params.get('userId') ?? params.get('userID') ?? params.get('user_id');
  const devUser = import.meta.env.VITE_DEV_USER_ID as string | undefined;
  const userStr = rawUser ?? devUser;
  if (userStr) {
    const n = Number(userStr);
    if (Number.isFinite(n) && n > 0) out.userId = Math.trunc(n);
  }

  // PLP sends the shopper's native language as ?nativeLanguage=; older callers used ?language=.
  const rawLang = params.get('nativeLanguage') ?? params.get('language');
  if (rawLang) {
    const lang = rawLang.toLowerCase();
    if (SUPPORTED_LANGUAGES.includes(lang)) {
      out.language = lang;
    }
  }

  const rawAvatar = params.get('avatar');
  if (rawAvatar) {
    const match = avatars.find((a) => a.id.toLowerCase() === rawAvatar.toLowerCase());
    if (match) {
      out.avatarId = match.id;
    }
  }

  // PLP passes the shopper's identity (sent as ?shopperName= / ?shopperEmail=;
  // accept a few aliases). Used only to attribute feedback — taken as-is.
  const rawName = params.get('shopperName') ?? params.get('userName') ?? params.get('name');
  if (rawName?.trim()) out.userName = rawName.trim();
  const rawEmail = params.get('shopperEmail') ?? params.get('userEmail') ?? params.get('email');
  if (rawEmail?.trim()) out.userEmail = rawEmail.trim();

  return out;
}
