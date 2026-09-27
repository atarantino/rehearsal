import { decodeError } from "./errors";
/** Readable server errors; plan-limit failures get a direct path to plans. */
export function ErrorNotice({
  error,
  onViewPlans,
}: {
  error: unknown;
  onViewPlans?: () => void;
}) {
  const decoded = decodeError(error);
  return (
    <div role="alert" className="auth-error prep-error">
      <p>{decoded.message}</p>
      {decoded.planLimit && onViewPlans && (
        <button type="button" className="text-button" onClick={onViewPlans}>
          View plans
        </button>
      )}
    </div>
  );
}
