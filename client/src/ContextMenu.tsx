import { useEffect, useRef, type ReactNode } from "react";
export function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    const menu = ref.current;
    if (menu) {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
      menu.querySelector<HTMLButtonElement>("button")?.focus();
    }
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [x, y]);
  return (
    <div
      className="context-menu"
      ref={ref}
      style={{ left: x, top: y }}
      aria-label="Actions contextuelles"
    >
      {children}
    </div>
  );
}
