import type { FullscreenWindowController } from "./useFullscreenWindow";

export function FullscreenControl({ fullscreen }: { fullscreen: FullscreenWindowController }) {
  const isFullscreen = fullscreen.isFullscreen === true;
  const label = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";

  return (
    <div className="fullscreen-control-group">
      <button
        aria-describedby="fullscreen-shortcut-help"
        aria-label={label}
        className="fullscreen-toggle"
        disabled={fullscreen.isPending || fullscreen.isFullscreen === null}
        onClick={() => void fullscreen.toggle()}
        title={`${label} (F11). Escape exits fullscreen.`}
        type="button"
      >
        {label}
      </button>
      <span className="visually-hidden" id="fullscreen-shortcut-help">
        Press F11 to toggle fullscreen. Press Escape to exit fullscreen.
      </span>
      {fullscreen.error ? (
        <span className="fullscreen-error" role="alert">
          {fullscreen.error}
        </span>
      ) : null}
    </div>
  );
}
