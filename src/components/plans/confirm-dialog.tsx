"use client";

import { useEffect, useId } from "react";

/**
 * A centred confirmation dialog over a dimmed page: a title, any content, and
 * Cancel / confirm buttons. Escape cancels unless `busy`.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  onConfirm,
  onCancel,
  busy = false,
  confirmDisabled = false,
  danger = false,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  confirmDisabled?: boolean;
  /** A destructive action: the confirm button is red. */
  danger?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/40 p-4" onClick={() => !busy && onCancel()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-[1.75rem] border-2 border-border bg-surface p-6 shadow-[0_3px_0_0_var(--border)]"
      >
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        <div className="space-y-3 text-sm text-muted">{children}</div>
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border-2 border-foreground/70 bg-surface px-5 py-2.5 text-sm font-display font-bold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`rounded-full border-[2.5px] border-foreground px-5 py-2.5 text-sm font-display font-bold text-surface shadow-[0_3px_0_0_var(--foreground)] active:translate-y-[3px] active:shadow-none disabled:opacity-40 disabled:shadow-none ${
              danger ? "bg-red-600" : "bg-accent"
            }`}
          >
            {busy ? (busyLabel ?? "Working…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
