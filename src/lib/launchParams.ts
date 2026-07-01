import type { AreaCode, AvatarId, Difficulty, LanguageCode } from '../types';
import { avatars } from '../data/avatars';

export interface LaunchParams {
  userId?: string;
  nativeLanguage?: LanguageCode;
  language?: LanguageCode;
  avatarId?: AvatarId;
  userName?: string;   // PLP shopper identity — used to attribute feedback
  userEmail?: string;
  // From the landing hub: pre-selected start settings + skip-landing flag.
  difficulty?: Difficulty;
  areas?: AreaCode[];
  audio?: boolean;
  autostart?: boolean;
  callbackURL?: string;     // hub return URL; navigated to when a game completes/quits
}

const SUPPORTED_LANGUAGES: LanguageCode[] = [
  'en', 'ja', 'ko', 'zh', 'es', 'pt', 'fr', 'tl', 'ro', 'hi', 'id', 'th', 'vi', 'ur',
];

/** Map a launch `level=` value onto our easy/medium/hard enum, or undefined if
 * unrecognized. The hub/PeakESL platform speaks beginner/medium/advanced (and
 * may capitalize, e.g. "Beginner"); without this mapping a `level=beginner`
 * launch silently falls through to a stale saved difficulty (e.g. a previous
 * "hard" run) instead of honoring the requested level. */
function normalizeLevel(raw: string | null): Difficulty | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === 'beginner' || v === 'easy') return 'easy';
  if (v === 'medium') return 'medium';
  if (v === 'advanced' || v === 'hard') return 'hard';
  return undefined;
}

export function parseLaunchParams(search: string): LaunchParams {
  const params = new URLSearchParams(search);
  const out: LaunchParams = {};

  // PLP identifies the shopper by their opaque CUID id, sent as ?userID=. The
  // legacy numeric distID is no longer sent or accepted. Accept a few casings;
  // fall back to VITE_DEV_USER_ID for local dev. The id is an opaque string —
  // no Number() coercion.
  const rawUser =
    params.get('userID') ?? params.get('userId') ?? params.get('user_id');
  const devUser = import.meta.env.VITE_DEV_USER_ID as string | undefined;
  const userStr = (rawUser ?? devUser)?.trim();
  if (userStr) out.userId = userStr;

  // nativeLanguage → vocab content; language → UI/display. Cross-fall back so a
  // legacy single-param caller still works.
  const norm = (raw: string | null): LanguageCode | undefined => {
    const l = raw?.toLowerCase();
    return l && SUPPORTED_LANGUAGES.includes(l) ? l : undefined;
  };
  const native = norm(params.get('nativeLanguage')) ?? norm(params.get('language'));
  const display = norm(params.get('language')) ?? native;
  if (native) out.nativeLanguage = native;
  if (display) out.language = display;

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

  // From the landing hub: pre-selected start settings + skip-landing flag.
  const level = normalizeLevel(params.get('level'));
  if (level) out.difficulty = level;

  const rawAreas = params.get('areas');
  if (rawAreas) out.areas = rawAreas.split(',').map((s) => s.trim()).filter(Boolean);

  const rawAudio = params.get('audio');
  if (rawAudio != null) out.audio = rawAudio !== '0' && rawAudio !== 'false';

  if (params.get('autostart') === '1') out.autostart = true;

  // Hub return target: the game navigates here when completed or quit. Only accept
  // http(s) URLs (so a crafted ?callbackURL=javascript:… can't run).
  const rawCallback = params.get('callbackURL') ?? params.get('callbackUrl') ?? params.get('callback');
  if (rawCallback && /^https?:\/\//i.test(rawCallback)) out.callbackURL = rawCallback;

  return out;
}
