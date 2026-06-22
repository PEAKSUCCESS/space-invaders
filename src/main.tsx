import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { parseLaunchParams } from './lib/launchParams'
import { loadSave } from './game/save'
import { loadUiStrings } from './i18n/i18n'

// Load the learner's native-language UI strings before the first render so the
// chrome paints already-translated (no English flash). Native language comes
// from the PLP launch URL, falling back to the last saved profile. No-op for
// English or on any error — the baked-in English defaults stay.
async function boot() {
  const lang = parseLaunchParams(window.location.search).language ?? loadSave()?.language;
  await loadUiStrings(lang);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
