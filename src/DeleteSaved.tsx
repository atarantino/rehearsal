import { useState } from "react";
import { Trash2 } from "lucide-react";

export function DeleteSaved({
  label,
  description,
  confirmLabel,
  disabled = false,
  onDelete,
  onBusy,
}: {
  label: string;
  description: string;
  confirmLabel: string;
  disabled?: boolean;
  onDelete: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!confirming)
    return (
      <button
        type="button"
        className="text-button"
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={15} /> {label}
      </button>
    );
  return (
    <div className="saved-removal" role="group" aria-label={label}>
      <p>{description}</p>
      {error && <p role="alert">{error}</p>}
      <div className="resume-actions">
        <button
          type="button"
          className="danger"
          disabled={disabled || busy}
          onClick={async () => {
            setBusy(true);
            onBusy(true);
            setError("");
            try {
              await onDelete();
              setConfirming(false);
            } catch (e) {
              const failure = e as { data?: unknown; message?: string };
              setError(
                typeof failure.data === "string"
                  ? failure.data
                  : failure.message || "Could not delete. Try again.",
              );
            } finally {
              setBusy(false);
              onBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : confirmLabel}
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => {
            setConfirming(false);
            setError("");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
