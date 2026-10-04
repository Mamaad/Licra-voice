import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useFullscreen() {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const native = "__TAURI_INTERNALS__" in window;
  async function exit() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } finally {
      if (native) await getCurrentWindow().setFullscreen(false);
    }
  }
  async function toggle() {
    if (document.fullscreenElement === container.current) return exit();
    await container.current?.requestFullscreen();
    if (native) await getCurrentWindow().setFullscreen(true);
  }
  useEffect(() => {
    let owned: Element | null = null;
    const change = () => {
      const fullscreen =
        !!container.current && document.fullscreenElement === container.current;
      owned = fullscreen ? container.current : null;
      setActive(fullscreen);
      if (native && !document.fullscreenElement)
        void getCurrentWindow()
          .setFullscreen(false)
          .catch(() => {});
    };
    document.addEventListener("fullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      if (
        owned &&
        (!document.fullscreenElement || document.fullscreenElement === owned)
      )
        void exit().catch(() => {});
    };
  }, []);
  return { container, active, toggle };
}
