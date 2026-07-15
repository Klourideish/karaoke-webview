import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { LocalMicrophoneSource } from "../microphones/types";
import { useDevelopmentPairing } from "../pairing/useDevelopmentPairing";
import type { ParticipantCommitProjection } from "../session-singers/types";
import { usePhysicalParticipantSetup } from "./usePhysicalParticipantSetup";

export function SyncDialog({
  eligibleSources,
  onClose,
  onCommit,
  onSuccess,
  onPhoneAccepted,
}: {
  eligibleSources: readonly LocalMicrophoneSource[];
  onClose: () => void;
  onCommit: (
    requestId: string,
    displayName: string,
    sourceId: string,
  ) => Promise<ParticipantCommitProjection>;
  onSuccess: (result: ParticipantCommitProjection) => void;
  onPhoneAccepted: () => Promise<void>;
}) {
  const setup = usePhysicalParticipantSetup({ onCommit, onSuccess });
  const pairing = useDevelopmentPairing();
  const [phoneFlow, setPhoneFlow] = useState(false);
  const selectedSource = eligibleSources.find((source) => source.id === setup.sourceId);
  const isSubmitting = setup.step === "submitting" || pairing.pendingAction !== null;
  const pairingStatus = pairing.projection.status;

  async function startPhonePairing() {
    setPhoneFlow(true);
    await pairing.create();
  }

  async function closeDialog() {
    if (
      phoneFlow &&
      pairingStatus.activeOfferId &&
      pairingStatus.lifecycleState &&
      !["accepted", "rejected", "expired", "cancelled"].includes(pairingStatus.lifecycleState)
    ) {
      await pairing.cancel();
    }
    onClose();
  }

  async function acceptParticipant() {
    const accepted = await pairing.accept();
    if (accepted?.status.lifecycleState === "accepted") {
      await onPhoneAccepted();
    }
  }

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
            onClick={() => void closeDialog()}
            aria-label="Close singer setup"
          >
            Close
          </button>
        </header>

        {!phoneFlow && setup.step === "choose-method" ? (
          <div className="sync-dialog-content">
            <p>How will this singer connect?</p>
            <div className="sync-method-list">
              <button type="button" onClick={() => void startPhonePairing()}>
                Connect phone
              </button>
              <p id="phone-sync-help">Pair a phone on the active development network.</p>
              <button type="button" onClick={setup.selectPhysical}>
                Use physical microphone
              </button>
            </div>
          </div>
        ) : null}

        {phoneFlow ? <PhonePairingContent pairing={pairing} onAccept={acceptParticipant} /> : null}

        {!phoneFlow && setup.step === "choose-microphone" ? (
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

        {!phoneFlow && setup.step === "enter-name" ? (
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

        {!phoneFlow &&
        (setup.step === "confirm" || setup.step === "submitting" || setup.step === "failed") ? (
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

        {(phoneFlow ? pairing.error : setup.error) ? (
          <p className="sync-dialog-error" role="alert">
            {phoneFlow ? pairing.error : setup.error}
          </p>
        ) : null}

        <footer className="sync-dialog-actions">
          {!phoneFlow && setup.step !== "choose-method" && setup.step !== "submitting" ? (
            <button type="button" onClick={setup.back}>
              Back
            </button>
          ) : null}
          <button type="button" disabled={isSubmitting} onClick={() => void closeDialog()}>
            Cancel
          </button>
          {!phoneFlow && setup.step === "choose-microphone" ? (
            <button type="button" disabled={!setup.sourceId} onClick={setup.toName}>
              Next
            </button>
          ) : null}
          {!phoneFlow && setup.step === "enter-name" ? (
            <button type="button" onClick={setup.nextFromName}>
              Next
            </button>
          ) : null}
          {!phoneFlow && (setup.step === "confirm" || setup.step === "failed") ? (
            <button type="button" onClick={() => void setup.submit()}>
              Create singer and assign microphone
            </button>
          ) : null}
          {!phoneFlow && setup.step === "submitting" ? <span>Creating singer...</span> : null}
        </footer>
      </section>
    </div>
  );
}

function PhonePairingContent({
  pairing,
  onAccept,
}: {
  pairing: ReturnType<typeof useDevelopmentPairing>;
  onAccept: () => Promise<void>;
}) {
  const { lifecycleState, pendingParticipant, acceptedParticipant, expiresInSeconds } =
    pairing.projection.status;
  const showQr =
    pairing.offer &&
    (lifecycleState === null ||
      lifecycleState === "created" ||
      lifecycleState === "displayed" ||
      lifecycleState === "claimed");
  const hasPhoneState =
    pairing.pendingAction === "create" || Boolean(showQr) || lifecycleState !== null;

  return (
    <div className="sync-dialog-content phone-pairing-content">
      <p className="sync-development-warning" role="note">
        Insecure development pairing. Use only on a trusted local network.
      </p>
      {pairing.pendingAction === "create" ? <p>Creating pairing code...</p> : null}
      {!hasPhoneState && !pairing.error ? (
        <p className="sync-empty-state" role="status">
          Pairing could not start. Check the development listener and try again.
        </p>
      ) : null}
      {showQr ? (
        <>
          <h3>Scan with the Karaoke Webview Android client</h3>
          <div className="sync-qr-code" aria-label="Development pairing QR code">
            <QRCodeSVG value={pairing.offer!.qrPayload} size={196} level="M" />
          </div>
          <p>
            Host: {pairing.offer!.hostAddress}:{pairing.offer!.controlPort}
          </p>
          <p>Expires in {expiresInSeconds ?? pairing.offer!.lifetimeSeconds} seconds.</p>
          <p className="sync-pairing-fallback">
            Development code: {pairing.offer!.pairingToken.slice(0, 8)}...
          </p>
          <p>Waiting for participant...</p>
        </>
      ) : null}
      {lifecycleState === "awaiting-participant-setup" ? (
        <>
          <h3>Phone connected</h3>
          <p>Waiting for participant setup on {pairing.projection.status.claimedClientName}.</p>
        </>
      ) : null}
      {lifecycleState === "awaiting-operator-approval" && pendingParticipant ? (
        <>
          <h3>Review participant</h3>
          <dl className="sync-summary">
            <div>
              <dt>Name</dt>
              <dd>{pendingParticipant.preferredDisplayName}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{pendingParticipant.clientName}</dd>
            </div>
          </dl>
          <div className="sync-review-actions">
            <button type="button" onClick={() => void pairing.reject()}>
              Reject
            </button>
            <button type="button" onClick={() => void onAccept()}>
              Accept participant
            </button>
          </div>
        </>
      ) : null}
      {lifecycleState === "accepted" && acceptedParticipant ? (
        <>
          <h3>Participant connected</h3>
          <p>{acceptedParticipant.acceptedDisplayName} was added to this session.</p>
        </>
      ) : null}
      {lifecycleState === "rejected" ? (
        <>
          <h3>Participant not added</h3>
          <p>{pairing.projection.status.lastRejectionMessage ?? "The proposal was rejected."}</p>
          <button type="button" onClick={() => void pairing.create()}>
            Generate another code
          </button>
        </>
      ) : null}
      {lifecycleState === "expired" || lifecycleState === "cancelled" ? (
        <>
          <h3>{lifecycleState === "expired" ? "Pairing code expired" : "Pairing cancelled"}</h3>
          <button type="button" onClick={() => void pairing.create()}>
            Generate another code
          </button>
        </>
      ) : null}
    </div>
  );
}
