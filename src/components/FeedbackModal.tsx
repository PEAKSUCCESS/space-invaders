import { useState } from 'react';
import { t } from '../i18n/i18n';

// What the feedback is about — built from the current lesson step. Shown in the
// modal so the user sees what they're commenting on, and sent with the message.
export interface FeedbackContext {
  challengeType: string;   // human label, e.g. "Pick the Word (image)"
  challengeKind: string;   // step kind
  pickMode?: string;
  senseId?: string;
  word?: string;
  pictureUrl?: string;
  sentence?: string;
}

interface Props {
  context: FeedbackContext;
  onClose: () => void;
  onSubmit: (message: string) => Promise<void>;
}

type Status = 'idle' | 'sending' | 'done' | 'error';

export function FeedbackModal({ context, onClose, onSubmit }: Props) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function send() {
    const text = message.trim();
    if (!text || status === 'sending') return;
    setStatus('sending');
    try {
      await onSubmit(text);
      setStatus('done');
      window.setTimeout(onClose, 1200);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal feedback-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {status === 'done' ? (
          <p className="feedback-thanks">{t('feedback.thanks')}</p>
        ) : (
          <>
            <h3>{t('chrome.giveFeedback')}</h3>
            <p className="modal-sub">{context.challengeType}</p>

            <div className="feedback-context">
              {context.pictureUrl ? (
                <img src={context.pictureUrl} alt="" className="feedback-image" />
              ) : context.sentence ? (
                <p className="feedback-sentence">“{context.sentence}”</p>
              ) : context.word ? (
                <p className="feedback-word">{context.word}</p>
              ) : null}
            </div>

            <textarea
              className="feedback-textarea"
              placeholder={t('feedback.placeholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              autoFocus
            />

            {status === 'error' && (
              <p className="feedback-error">{t('feedback.error')}</p>
            )}

            <div className="modal-actions">
              <button type="button" className="ghost-btn small" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="primary-btn small"
                onClick={send}
                disabled={!message.trim() || status === 'sending'}
              >
                {status === 'sending' ? t('feedback.sending') : t('feedback.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
