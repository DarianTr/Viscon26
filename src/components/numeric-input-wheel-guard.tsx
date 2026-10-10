"use client";

import { useEffect } from "react";

/** Scrolling over a focused number input must not change its value — only typing should. */
export function NumericInputWheelGuard() {
    useEffect(() => {
        function handleWheel(e: WheelEvent) {
            const target = e.target;
            if (
                target instanceof HTMLInputElement &&
                target.type === "number" &&
                target === document.activeElement
            ) {
                e.preventDefault();
            }
        }
        window.addEventListener("wheel", handleWheel, { passive: false });
        return () => window.removeEventListener("wheel", handleWheel);
    }, []);

    return null;
}
