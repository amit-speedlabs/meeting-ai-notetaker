'use client';

export const CONSENT_TEXT =
  'This meeting will be recorded/transcribed to generate meeting notes. Please ensure all required participants have been informed and consent where applicable.';

export default function ConsentModal({ onAccept, onCancel, details, busy }: { onAccept: () => void; onCancel: () => void; details?: React.ReactNode; busy?: boolean }) {
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="modal">
        <h2 id="consent-title">Recording consent</h2>
        <p>{CONSENT_TEXT}</p>
        {details && <div className="small muted" style={{ marginBottom: 12 }}>{details}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={onAccept} disabled={busy} data-testid="consent-accept">
            I Understand — Start Meeting
          </button>
        </div>
      </div>
    </div>
  );
}
