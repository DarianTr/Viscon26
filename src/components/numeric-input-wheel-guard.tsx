"use client";

import { useEffect } from "react";

/**
 * Scrolling over a focused number input must not change its value — only typing should.
 * Blurring (rather than preventDefault) stops the browser's scroll-to-increment behavior
 * without also blocking the page's native scroll for that same wheel event.
 */
export function NumericInputWheelGuard() {
    useEffect(() => {
        function handleWheel(e: WheelEvent) {
            const target = e.target;
            if (
                target instanceof HTMLInputElement &&
                target.type === "number" &&
                target === document.activeElement
            ) {
                target.blur();
            }
        }
        window.addEventListener("wheel", handleWheel, { passive: true });
        return () => window.removeEventListener("wheel", handleWheel);
    }, []);

    return null;
}
