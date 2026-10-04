import { invoke } from "@tauri-apps/api/core";
import { useStore, applyEvent, remember } from "./store";
import { parseAddress } from "./address.mjs";
import { joinVoice, leaveVoice } from "./voice";
import type { Envelope } from "./types";
import { CLIENT_VERSION, PROTOCOL_VERSION } from "./version";
export { CLIENT_VERSION, PROTOCOL_VERSION };
let socket: WebSocket | undefined,
  base = "",
  intent = false,
  retries = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
let last: { address: string; nickname: string } | undefined;
const pending = new Map<
  string,
  {
    resolve: (p: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const codes: Record<string, string> = {
  PERMISSION_DENIED: "Permission refusée",
  AUTH_FAILED: "Signature d’identité invalide",
  INVALID_ADMIN_TOKEN: "Token administrateur invalide",
  CHANNEL_FULL: "Salon complet",
  CHANNEL_PASSWORD: "Mot de passe du salon incorrect",
  MEDIA_UNAVAILABLE: "LiveKit indisponible",
  LAST_OWNER: "Le dernier Owner doit être conservé",
  INCOMPATIBLE_VERSION:
    "Cette version du client n’est plus compatible avec ce serveur.",
  RATE_LIMITED: "Trop de requêtes",
  IDENTITY_CONNECTED: "Cette identité est déjà connectée",
  CHANNEL_OCCUPIED: "Le salon contient des utilisateurs",
  CHANNEL_HAS_CHILDREN: "Supprimer les sous-salons d’abord",
};
function transmit(
  type: string,
  payload: unknown,
  request_id = crypto.randomUUID(),
) {
  if (socket?.readyState !== WebSocket.OPEN)
    throw new Error("Serveur déconnecté");
  socket.send(
    JSON.stringify({
      type,
      request_id,
      timestamp: new Date().toISOString(),
      payload,
    }),
  );
  return request_id;
}
export function request(type: string, payload: unknown = {}): Promise<any> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("La requête a expiré"));
    }, 10000);
    pending.set(id, { resolve, reject, timer: timeout });
    try {
      transmit(type, payload, id);
    } catch (e) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(e);
    }
  });
}
export async function connect(address: string, nickname: string) {
  if (!nickname.trim() || [...nickname].length > 32)
    throw new Error("Pseudo requis, 32 caractères maximum");
  disconnect();
  intent = true;
  last = { address, nickname };
  retries = 0;
  await open(address, nickname);
}
async function open(address: string, nickname: string) {
  const target = parseAddress(address);
  base = target.ws;
  const publicKey = await invoke<string>("identity_public");
  useStore.getState().set({ status: "connecting", address, error: "" });
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(base + "/ws");
    socket = ws;
    let authenticated = false;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Connexion expirée"));
    }, 12000);
    ws.onopen = () => {
      if (ws !== socket) return;
      transmit("CLIENT_HELLO", {
        protocol_version: PROTOCOL_VERSION,
        client_version: CLIENT_VERSION,
        nickname,
        device_public_key: publicKey,
        platform: "windows",
        capabilities: ["voice"],
      });
    };
    ws.onmessage = async (e) => {
      if (ws !== socket) return;
      try {
        const m = JSON.parse(e.data) as Envelope;
        const p = m.payload as any;
        if (m.type === "SERVER_HELLO") {
          const context = [
            "licra:v1",
            p.server_id,
            p.nonce,
            CLIENT_VERSION,
            nickname,
            publicKey,
          ].join("\n");
          if (context !== p.challenge_context)
            throw new Error("Challenge serveur invalide");
          const signature = await invoke<string>("identity_sign", { context });
          if (ws === socket) transmit("AUTHENTICATE", { signature });
          return;
        }
        if (m.type === "PING") {
          transmit("PONG", {});
          return;
        }
        if (m.type === "ERROR") {
          const error = new Error(codes[p.code] ?? p.code);
          if (p.code === "INCOMPATIBLE_VERSION")
            window.dispatchEvent(new Event("licra:check-update"));
          const task = m.request_id ? pending.get(m.request_id) : undefined;
          if (task) {
            clearTimeout(task.timer);
            task.reject(error);
            pending.delete(m.request_id!);
          } else {
            useStore.getState().set({ error: error.message });
          }
          if (!authenticated) {
            clearTimeout(timeout);
            intent = false;
            ws.close();
            reject(error);
          }
          return;
        }
        if (m.type === "KICK" || m.type === "BAN") {
          intent = false;
          useStore
            .getState()
            .set({ error: p.reason || "Déconnexion par le serveur" });
          ws.close();
          return;
        }
        if (m.type === "ACK" && m.request_id) {
          const task = pending.get(m.request_id);
          if (task) {
            clearTimeout(task.timer);
            pending.delete(m.request_id);
            task.resolve(p);
          }
        }
        applyEvent(m.type, p);
        if (m.type === "SNAPSHOT") {
          authenticated = true;
          clearTimeout(timeout);
          retries = 0;
          remember(address);
          resolve();
        }
        if (m.type === "VOICE_JOIN")
          await joinVoice(base + p.signaling_path, p);
        if (m.type === "VOICE_LEFT") await leaveVoice();
        if (m.type === "VOICE_REJOIN_REQUIRED") await request("REFRESH_VOICE");
      } catch (error) {
        useStore.getState().set({ error: String(error) });
        if (!authenticated) {
          clearTimeout(timeout);
          ws.close();
          reject(error);
        }
      }
    };
    ws.onerror = () =>
      useStore.getState().set({ error: "Connexion réseau impossible" });
    ws.onclose = () => {
      clearTimeout(timeout);
      if (ws !== socket) return;
      void leaveVoice();
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("Connexion fermée"));
      }
      pending.clear();
      useStore
        .getState()
        .set({ status: "disconnected", users: [], self_id: "", talking: [] });
      if (!authenticated) reject(new Error("Connexion fermée"));
      if (intent && last) {
        const delay = Math.min(30000, 1000 * 2 ** retries++);
        timer = setTimeout(() => {
          if (last) void open(last.address, last.nickname).catch(report);
        }, delay);
      }
    };
  });
}
export function disconnect() {
  intent = false;
  clearTimeout(timer);
  const old = socket;
  socket = undefined;
  old?.close();
  void leaveVoice();
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error("Déconnexion"));
  }
  pending.clear();
  useStore.getState().set({
    status: "disconnected",
    users: [],
    self_id: "",
    permissions: {},
    channel_permissions: {},
  });
}
export function report(e: unknown) {
  useStore
    .getState()
    .set({ error: e instanceof Error ? e.message : String(e) });
}

export async function changeNickname(nickname: string) {
  await request("SET_NICKNAME", { nickname });
  if (last) last.nickname = nickname;
  localStorage.setItem("nickname", nickname);
}
