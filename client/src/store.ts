import { create } from "zustand";
import type { Role, Snapshot } from "./types";
function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export const initialSettings = {
  input: "",
  output: "",
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  mode: "continuous" as "continuous" | "ptt" | "activation",
  shortcut: "Control+Space",
  threshold: 0.035,
};
export type Settings = typeof initialSettings;
export interface Favorite {
  name: string;
  address: string;
  nickname: string;
}
interface State extends Snapshot {
  status: string;
  error: string;
  address: string;
  selected: string;
  muted: boolean;
  deafened: boolean;
  talking: string[];
  settings: Settings;
  history: string[];
  favorites: Favorite[];
  volumes: Record<string, number>;
  localMuted: Record<string, boolean>;
  set: (p: Partial<State>) => void;
  saveSettings: (p: Partial<Settings>) => void;
}
export const useStore = create<State>((set, get) => ({
  server: { id: "", name: "Licra" },
  self_id: "",
  channels: [],
  users: [],
  roles: [],
  permissions: {},
  channel_permissions: {},
  status: "disconnected",
  error: "",
  address: "",
  selected: "",
  muted: false,
  deafened: false,
  talking: [],
  settings: { ...initialSettings, ...saved("settings", {}) },
  history: saved("history", []),
  favorites: saved("favorites", []),
  volumes: saved("volumes", {}),
  localMuted: {},
  set,
  saveSettings: (p) => {
    const settings = { ...get().settings, ...p };
    localStorage.setItem("settings", JSON.stringify(settings));
    set({ settings });
  },
}));
export function applyEvent(type: string, p: any) {
  const s = useStore.getState();
  switch (type) {
    case "SNAPSHOT":
      s.set({ ...p, status: "connected", error: "" });
      break;
    case "USER_CONNECTED":
    case "USER_UPDATED":
    case "USER_MOVED":
    case "VOICE_STATE_UPDATED":
      s.set({ users: [...s.users.filter((u) => u.id !== p.id), p] });
      break;
    case "USER_DISCONNECTED":
      s.set({ users: s.users.filter((u) => u.id !== p.id) });
      break;
    case "CHANNEL_CREATED":
    case "CHANNEL_UPDATED":
      s.set({ channels: [...s.channels.filter((c) => c.id !== p.id), p] });
      break;
    case "CHANNEL_DELETED":
      s.set({
        channels: s.channels.filter((c) => c.id !== p.id),
        selected: s.selected === p.id ? "" : s.selected,
      });
      break;
    case "PERMISSIONS_UPDATED":
      s.set(p);
      break;
    case "ROLE_UPDATED":
      s.set({ roles: p.roles as Role[] });
      break;
    case "SERVER_INFO_UPDATED":
      s.set({ server: { ...s.server, ...p } });
      break;
  }
}
export function remember(address: string) {
  const s = useStore.getState();
  const history = [address, ...s.history.filter((x) => x !== address)].slice(
    0,
    20,
  );
  localStorage.setItem("history", JSON.stringify(history));
  s.set({ history });
}
