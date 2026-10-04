import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { User } from "./types";
const paths: Record<string, ReactNode> = {
  screen: (<><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>),
  server: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
      <path d="m8 10 4-2 4 2v4l-4 2-4-2Z" />
    </>
  ),
  channel: (
    <>
      <path d="m11 4-6 5H2v6h3l6 5Z" />
      <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M2 20v-2a7 7 0 0 1 14 0v2ZM16 4a3 3 0 0 1 0 6M19 13a6 6 0 0 1 3 5v2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </>
  ),
  micOff: (
    <>
      <path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M15 9V5a3 3 0 0 0-6-1M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8" />
    </>
  ),
  headphones: (
    <>
      <path d="M3 13v-1a9 9 0 0 1 18 0v1" />
      <rect x="3" y="12" width="4" height="9" rx="2" />
      <rect x="17" y="12" width="4" height="9" rx="2" />
    </>
  ),
  volume: (
    <>
      <path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 4 2 2v4l3 1 1 3h6l1-3 3-1v-4l2-2-2-4-3-1-1-3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 8 4v7c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  crown: (
    <>
      <path d="m2 6 5 5 5-8 5 8 5-5-3 13H5ZM5 22h14" />
    </>
  ),
  connect: (
    <>
      <path d="M8 2v5M16 2v5M5 7h14v5a7 7 0 0 1-14 0ZM12 19v3" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  chevron: <path d="m8 5 7 7-7 7" />,
  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="4" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="20" r="1" />
    </>
  ),
  star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="12" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7v1" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  logout: (
    <>
      <path d="M10 3H3v18h7M8 12h14m-5-5 5 5-5 5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
  bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8Z" />,
  logs: (
    <>
      <path d="M5 2h10l4 4v16H5ZM14 2v5h5M8 11h8M8 15h8M8 19h5" />
    </>
  ),
  activity: <path d="M2 12h5l3-9 4 18 3-9h5" />,
  refresh: (
    <>
      <path d="M20 8V3l-3 3a8 8 0 1 0 3 11M20 8h-5" />
    </>
  ),
  edit: (
    <>
      <path d="m14 4 6 6M3 21l2-7L17 2l5 5-12 12ZM3 21l7-2" />
    </>
  ),
  home: (
    <>
      <path d="m2 11 10-9 10 9M5 9v13h5v-8h4v8h5V9" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m6 6 12 12" />
    </>
  ),
  move: (
    <>
      <path d="M12 2v20M2 12h20m-5-5 5 5-5 5M7 7l-5 5 5 5M7 7l5-5 5 5M7 17l5 5 5-5" />
    </>
  ),
  download: (
    <>
      <path d="M12 2v13m-5-5 5 5 5-5M3 16v6h18v-6" />
    </>
  ),
};
export type IconName = keyof typeof paths;
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function IconButton({
  icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`icon-button ${props.className ?? ""}`}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}
export function Logo() {
  return (
    <div className="core-logo">
      <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
        <path
          d="m32 3 25 14v30L32 61 7 47V17Z"
          fill="none"
          stroke="#1677ff"
          strokeWidth="7"
        />
        <path
          d="M32 3v13M57 17l-12 7M7 47l12-7"
          stroke="#07111f"
          strokeWidth="3"
        />
      </svg>
      <strong>Licra</strong>
    </div>
  );
}
export function Avatar({
  name,
  identity = name,
  large = false,
}: {
  name: string;
  identity?: string;
  large?: boolean;
}) {
  const hue = [...identity].reduce(
    (n, c) => (n * 31 + c.charCodeAt(0)) % 360,
    0,
  );
  return (
    <span
      className={`avatar ${large ? "large" : ""}`}
      style={{
        background: `hsl(${hue} 33% 25%)`,
        color: `hsl(${hue} 65% 84%)`,
      }}
      aria-hidden="true"
    >
      {name
        .trim()
        .split(/\s+/)
        .map((x) => x[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?"}
    </span>
  );
}
export function VoiceActivityIndicator({ active }: { active: boolean }) {
  return (
    <span
      className={`voice-activity ${active ? "active" : ""}`}
      aria-label={active ? "Parle" : "En écoute"}
    >
      {[1, 2, 3, 4].map((i) => (
        <i key={i} />
      ))}
    </span>
  );
}
export function AudioStatusIcon({ user }: { user: User }) {
  return (
    <span className="audio-status">
      {user.deafened && <Icon name="headphones" className="danger-text" />}
      <Icon
        name={
          user.muted || user.server_muted || user.deafened ? "micOff" : "mic"
        }
        className={
          user.muted || user.server_muted || user.deafened ? "danger-text" : ""
        }
      />
    </span>
  );
}
export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} aria-hidden="true" />;
}
export const connectionLabels: Record<string, string> = {
  connected: "Connecté",
  disconnected: "Déconnecté",
  connecting: "Connexion…",
  reconnecting: "Reconnexion…",
  failed: "Connexion impossible",
};
