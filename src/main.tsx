import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PeakHeader } from './components/PeakHeader'
import { parseLaunchParams } from './lib/launchParams'
import { loadSave } from './game/save'
import { loadUiStrings } from './i18n/i18n'

// Load native-language UI strings before the first render. The PeakESL header is
// mounted above <App> so it shows on every screen.
async function boot() {
  const params = parseLaunchParams(window.location.search);
  const lang = params.language ?? loadSave()?.language;
  await loadUiStrings(lang);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PeakHeader userName={params.userName} />
      <App />
    </StrictMode>,
  );
}

boot();
