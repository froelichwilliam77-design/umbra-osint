import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button className="absolute inset-0 bg-black/70" aria-label="Dismiss" onClick={onCancel} />
      <div className="relative m-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] w-full max-w-md rounded-2xl border border-ink-600 bg-ink-900 p-4 shadow-panel max-h-[min(90dvh,36rem)] overflow-y-auto">
        <h2 className="text-base font-medium text-fog-100">{title}</h2>
        <div className="mt-3 text-sm text-fog-300">{body}</div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            type="button"
            className={`tap-lg w-full sm:w-auto ${danger ? "border-signal-blocked bg-signal-blocked/20 text-fog-100" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button type="button" variant="outline" className="tap-lg w-full sm:w-auto" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CopyDialog({
  title,
  value,
  onClose,
}: {
  title: string;
  value: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button className="absolute inset-0 bg-black/70" aria-label="Dismiss" onClick={onClose} />
      <div className="relative m-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] w-full max-w-md rounded-2xl border border-ink-600 bg-ink-900 p-4 shadow-panel max-h-[min(90dvh,36rem)] overflow-y-auto">
        <h2 className="text-base font-medium text-fog-100">{title}</h2>
        <p className="mt-3 break-all rounded-lg border border-ink-600 bg-ink-950 p-3 font-mono text-xs text-fog-100">{value}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            type="button"
            className="tap-lg w-full sm:w-auto"
            onClick={() => {
              void navigator.clipboard.writeText(value).catch(() => undefined);
              onClose();
            }}
          >
            Copy
          </Button>
          <Button type="button" variant="outline" className="tap-lg w-full sm:w-auto" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
