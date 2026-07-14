import type { LocalMicrophoneSource } from "../microphones/types";
import type { ParticipantCommitProjection } from "../session-singers/types";
import { usePhysicalParticipantSetup } from "./usePhysicalParticipantSetup";

export function SyncDialog({
  eligibleSources,
  onClose,
  onCommit,
  onSuccess,
}: {
  eligibleSources: readonly LocalMicrophoneSource[];
  onClose: () => void;
  onCommit: (
    requestId: string,
    displayName: string,
    sourceId: string,
  ) => Promise<ParticipantCommitProjection>;
  onSuccess: (result: ParticipantCommitProjection) => void;
}) {
  const setup = usePhysicalParticipantSetup({ onCommit, onSuccess });
  const selectedSource = eligibleSources.find((source) => source.id === setup.sourceId);
  const isSubmitting = setup.step === "submitting";

  return (
    <div className="sync-dialog-backdrop" role="presentation">
      <section
        className="sync-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-dialog-title"
      >
        <header className="sync-dialog-header">
          <div>
            <p className="region-label">Singer setup</p>
            <h2 id="sync-dialog-title">Sync a singer</h2>
          </div>
          <button
            className="sync-dialog-close"
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close singer setup"
          >
            Close
          </button>
        </header>

        {setup.step === "choose-method" ? (
          <div className="sync-dialog-content">
            <p>How will this singer connect?</p>
            <div className="sync-method-list">
              <button type="button" disabled aria-describedby="phone-sync-help">
                Connect phone
              </button>
              <p id="phone-sync-help">QR pairing will be added in P5-002.</p>
              <button type="button" onClick={setup.selectPhysical}>
                Use physical microphone
              </button>
            </div>
          </div>
        ) : null}

        {setup.step === "choose-microphone" ? (
          <div className="sync-dialog-content">
            <h3>Choose microphone</h3>
            {eligibleSources.length === 0 ? (
              <p className="sync-empty-state">No available physical microphones.</p>
            ) : (
              <label>
                Microphone
                <select
                  className="microphone-select"
                  value={setup.sourceId}
                  onChange={(event) => setup.setSourceId(event.target.value)}
                >
                  <option value="">Choose a microphone</option>
                  {eligibleSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.displayName}
                      {source.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : null}

        {setup.step === "enter-name" ? (
          <div className="sync-dialog-content">
            <h3>Enter singer name</h3>
            <label>
              Singer name
              <input
                autoFocus
                type="text"
                maxLength={80}
                value={setup.displayName}
                onChange={(event) => setup.setDisplayName(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        {setup.step === "confirm" || setup.step === "submitting" || setup.step === "failed" ? (
          <div className="sync-dialog-content">
            <h3>Confirm singer setup</h3>
            <dl className="sync-summary">
              <div>
                <dt>Singer</dt>
                <dd>{setup.displayName}</dd>
              </div>
              <div>
                <dt>Microphone</dt>
                <dd>{selectedSource?.displayName ?? "No longer available"}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {setup.error ? (
          <p className="sync-dialog-error" role="alert">
            {setup.error}
          </p>
        ) : null}

        <footer className="sync-dialog-actions">
          {setup.step !== "choose-method" && setup.step !== "submitting" ? (
            <button type="button" onClick={setup.back}>
              Back
            </button>
          ) : null}
          <button type="button" disabled={isSubmitting} onClick={onClose}>
            Cancel
          </button>
          {setup.step === "choose-microphone" ? (
            <button type="button" disabled={!setup.sourceId} onClick={setup.toName}>
              Next
            </button>
          ) : null}
          {setup.step === "enter-name" ? (
            <button type="button" onClick={setup.nextFromName}>
              Next
            </button>
          ) : null}
          {setup.step === "confirm" || setup.step === "failed" ? (
            <button type="button" onClick={() => void setup.submit()}>
              Create singer and assign microphone
            </button>
          ) : null}
          {setup.step === "submitting" ? <span>Creating singer...</span> : null}
        </footer>
      </section>
    </div>
  );
}
