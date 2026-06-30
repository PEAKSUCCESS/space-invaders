import './PeakHeader.css';

// Where "Home" sends the learner — back into PeakESL.
// Optionally override per-environment with VITE_PEAKESL_URL in .env.local.
const PEAKESL_URL =
  (import.meta.env.VITE_PEAKESL_URL as string | undefined) ?? 'https://app.peakesl.com';

// Label for the current section (mirrors a PeakESL nav link). Does nothing.
const VOCAB_LABEL = 'Vocab';

export function PeakHeader({ userName }: { userName?: string }) {
  function goHome() {
    window.location.href = PEAKESL_URL;
  }

  return (
    // Reserves the 56px the fixed header occupies (mirrors PeakESL's h-14 wrapper).
    <div className="peak-header-root">
      <header className="peak-header">
        {/* Logo — far left, not clickable */}
        <img className="peak-header-logo" src="/peak_logo.png" alt="Peak ESL logo" />

        <nav className="peak-header-nav">
          {/* Left-aligned links */}
          <ul className="peak-header-links">
            <li className="peak-header-item">
              <button type="button" className="peak-header-link is-clickable" onClick={goHome}>
                Home
              </button>
            </li>
            <li className="peak-header-item">
              {/* Current section — does nothing */}
              <span className="peak-header-link">{VOCAB_LABEL}</span>
            </li>
          </ul>

          {/* Right-aligned: learner name, no avatar, does nothing */}
          <ul className="peak-header-right">
            {userName && (
              <li className="peak-header-item">
                <span className="peak-header-name">{userName}</span>
              </li>
            )}
          </ul>
        </nav>
      </header>
    </div>
  );
}
