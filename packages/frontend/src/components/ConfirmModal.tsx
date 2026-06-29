/**
 * ConfirmModal — reusable destructive-action confirmation.
 *
 * User reported (2026-06-29): "when deleting any record a popup should appear
 * 'are you sure you want to delete' and till the time is deleted it should not
 * move to any other record. I feel multiple records could have been deleted as
 * the system was taking its time."
 *
 * Two behaviours that solve that:
 *  1. Modal is *blocking* — the rest of the UI is dim + pointer-events:none
 *     while the request is pending, so a user can't fire a second delete on
 *     a different row.
 *  2. The Confirm button shows a spinner + becomes disabled the moment the
 *     mutation kicks off, so the user gets immediate feedback that the action
 *     is in flight (instead of wondering "did my click register").
 *
 * Usage:
 *   const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
 *   ...
 *   <button onClick={() => setConfirm({ id: u.id, name: u.name })}>Remove</button>
 *   ...
 *   <ConfirmModal
 *     open={!!confirm}
 *     title={`Remove ${confirm?.name}?`}
 *     body="This user will be deactivated. Their history stays for reporting."
 *     confirmLabel="Remove"
 *     loading={mutation.isPending}
 *     onCancel={() => setConfirm(null)}
 *     onConfirm={() => mutation.mutate(confirm!.id, { onSuccess: () => setConfirm(null) })}
 *   />
 */
import { Loader2, AlertTriangle } from 'lucide-react';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;          // red confirm button (default true — we use this mostly for deletes)
  loading?: boolean;              // disables both buttons + shows spinner on confirm
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive = true, loading = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (loading) return;
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-white border border-gray-200 rounded-2xl shadow-2xl w-full max-w-md"
        // Prevent the in-flight delete from being interrupted by a stray
        // backdrop click while the request is still in flight.
        style={{ pointerEvents: loading ? 'none' : 'auto' }}
      >
        <div className="p-6 flex gap-4">
          <div className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center ${
            destructive ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
          }`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            {body && <p className="text-sm text-gray-500 mt-1 leading-relaxed">{body}</p>}
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-semibold text-white rounded-xl flex items-center gap-2 disabled:opacity-60 ${
              destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-brand-600 hover:bg-brand-500'
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
