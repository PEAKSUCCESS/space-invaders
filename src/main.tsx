import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { parseLaunchParams } from './lib/launchParams'
import { loadSave } from './game/save'
import { loadUiStrings } from './i18n/i18n'

// Load native-language UI strings before the first render (no English flash).
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
