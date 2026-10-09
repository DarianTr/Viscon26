"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  /** Shown above the title: an avatar, a thumbnail, the comment being deleted. */
  preview?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
};

/**
 * A styled replacement for `window.confirm`. Render `dialog` somewhere in the
 * component, then `if (await confirm({ … })) …`. Esc, Cancel and a click on
 * the backdrop all count as "no".
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(ok: boolean) => void>(undefined);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!options || !dialog || dialog.open) return;
    // Esc closes without setting a value, so clear the last answer first.
    dialog.returnValue = "";
    dialog.showModal();
  }, [options]);

  function confirm(next: ConfirmOptions) {
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => (resolver.current = resolve));
  }

  function onClose() {
    resolver.current?.(ref.current?.returnValue === "confirm");
    resolver.current = undefined;
    setOptions(null);
  }

  const dialog = (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the dialog element itself (not its content) is the backdrop.
      onClick={(e) => e.target === ref.current && ref.current.close("cancel")}
      aria-labelledby={titleId}
      className="m-auto w-[min(92vw,22rem)] rounded-3xl bg-surface p-0 text-foreground shadow-2xl ring-1 ring-border transition-[opacity,scale] duration-150 backdrop:bg-black/40 backdrop:backdrop-blur-sm starting:open:scale-95 starting:open:opacity-0"
    >
      {options && (
        <form method="dialog" className="flex flex-col items-center gap-2 p-6 text-center">
          {options.preview && <div className="mb-2">{options.preview}</div>}
          <h2 id={titleId} className="text-lg font-bold">
            {options.title}
          </h2>
          {options.message && <p className="text-sm text-muted">{options.message}</p>}
          <div className="mt-4 grid w-full grid-cols-2 gap-2">
            <button value="cancel" autoFocus className="rounded-full bg-surface-2 py-2.5 text-sm font-semibold">
              {options.cancelLabel ?? "Cancel"}
            </button>
            <button value="confirm" className="rounded-full bg-tempo py-2.5 text-sm font-semibold text-white">
              {options.confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );

  return [confirm, dialog];
}
