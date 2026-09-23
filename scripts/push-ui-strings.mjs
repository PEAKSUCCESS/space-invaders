// Publish this game's UI-string translations (scripts/ui-strings.json) to the
// peakvocab-api ui_strings table, so Space Attack — and its Vocab Hub tile —
// render in the learner's language like every other game.
//
// All strings live in the shared `Challenges` app set. This writes through the
// API's admin endpoint (the same one PeakESL's Admin > Vocabulary uses), and by
// default only ADDS keys the live table doesn't have yet, so a translation
// someone already edited in PeakESL is never reverted. `--force` overwrites.
//
//   VOCAB_ADMIN_TOKEN=… node scripts/push-ui-strings.mjs            # stage
//   VOCAB_ADMIN_TOKEN=… VOCAB_API_URL=https://vocab.peaksuccess.com node scripts/push-ui-strings.mjs   # prod
//   add --dry-run to see what would change without writing.
//
// The token is the API's API_ADMIN_TOKEN for that environment (PeakESL's
// VOCAB_ADMIN_TOKEN holds the same value). Afterwards, regenerate the API repo's
// seed files (`npx tsx scripts/dump-ui-strings.ts` there) so they mirror live.
import { readFileSync } from 'fs';

const API = process.env.VOCAB_API_URL || 'https://peakvocab-api-stage-vkkf2.ondigitalocean.app';
const TOKEN = process.env.VOCAB_ADMIN_TOKEN;
const APP = 'Challenges';
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

if (!TOKEN) {
  console.error('VOCAB_ADMIN_TOKEN is not set (the API_ADMIN_TOKEN for this environment).');
  process.exit(1);
}

const wanted = JSON.parse(readFileSync(new URL('./ui-strings.json', import.meta.url), 'utf8'));
const auth = { Authorization: `Bearer ${TOKEN}` };

const gridRes = await fetch(`${API}/api/app/admin/ui-strings?app=${APP}`, { headers: auth });
if (!gridRes.ok) {
  console.error(`GET admin/ui-strings → ${gridRes.status}: ${await gridRes.text()}`);
  process.exit(1);
}
const live = new Map((await gridRes.json()).rows.map((r) => [r.key, r.text]));

const rows = [];
for (const [key, text] of Object.entries(wanted)) {
  const have = live.get(key) ?? {};
  const changes = Object.fromEntries(
    Object.entries(text).filter(([lang, value]) => (force || !have[lang]) && have[lang] !== value),
  );
  if (Object.keys(changes).length > 0) rows.push({ key, text: changes });
}

console.log(`${API} · ${rows.length} of ${Object.keys(wanted).length} keys need writing${force ? ' (--force)' : ''}`);
for (const r of rows) console.log(`  ${r.key}: ${Object.keys(r.text).join(', ')}`);
if (dryRun || rows.length === 0) process.exit(0);

const putRes = await fetch(`${API}/api/app/admin/ui-strings`, {
  method: 'PUT',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ app: APP, rows }),
});
if (!putRes.ok) {
  console.error(`PUT admin/ui-strings → ${putRes.status}: ${await putRes.text()}`);
  process.exit(1);
}
console.log('written:', await putRes.json());

// Check what a learner actually gets back.
for (const lang of ['en', 'es', 'ja', 'ko']) {
  const body = await (await fetch(`${API}/api/app/ui-strings?appName=SpaceInvaders&lang=${lang}`)).json();
  const missing = Object.keys(wanted).filter((k) => !body.strings?.[k]);
  console.log(`  ${lang}: ${missing.length === 0 ? 'all keys served' : `missing ${missing.join(', ')}`}`);
}
