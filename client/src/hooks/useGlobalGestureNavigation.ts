import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

type GestureRoutes = {
  up: string;
  down: string;
  left: string;
  right: string;
};

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

/**
 * Global, mobile-first gesture contract (unchanging):
 * - Swipe Up   -> routes.up
 * - Swipe Down -> routes.down
 * - Swipe Left -> routes.left
 * - Swipe Right-> routes.right
 *
 * Also binds PageDown -> routes.down (global).
 *
 * Notes:
 * - Avoids hijacking events while typing in inputs/textareas/contenteditable.
 * - Uses a simple directional threshold; no conditional disabling.
 */
export function useGlobalGestureNavigation(routes: GestureRoutes) {
  const [, setLocation] = useLocation();

  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(
    null
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInputTarget(e.target)) return;
      if (e.defaultPrevented) return;

      // Global PageDown -> Control Room
      if (e.key === "PageDown") {
        e.preventDefault();
        setLocation(routes.down);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (isTextInputTarget(e.target)) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;
      if (isTextInputTarget(e.target)) return;

      const t = e.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const dt = Date.now() - start.t;

      // Tune for "one gesture system, everywhere"
      const MIN_DISTANCE = 70;
      const MAX_DURATION_MS = 900;

      if (dt > MAX_DURATION_MS) return;

      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < MIN_DISTANCE) return;

      // Vertical swipe
      if (absY > absX) {
        if (dy < 0) {
          setLocation(routes.up);
        } else {
          setLocation(routes.down);
        }
        return;
      }

      // Horizontal swipe
      if (dx < 0) {
        setLocation(routes.left);
      } else {
        setLocation(routes.right);
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("keydown", onKeyDown as any);
      window.removeEventListener("touchstart", onTouchStart as any);
      window.removeEventListener("touchend", onTouchEnd as any);
    };
  }, [routes.down, routes.left, routes.right, routes.up, setLocation]);
}

