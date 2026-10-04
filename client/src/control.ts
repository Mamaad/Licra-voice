import { invoke } from "@tauri-apps/api/core";
import { useStore, applyEvent, remember } from "./store";
import { parseAddress } from "./address.mjs";
import { joinVoice, leaveVoice, syncVoicePermissions } from "./voice";
import { applyChatEvent } from "./chat";
import { screenEvent, syncScreens, closeScreens } from "./screen";
import {
  youtubeEvent,
  syncYouTube,
  clearYouTube,
  sampleYouTubeClock,
} from "./youtube";
import type { Envelope } from "./types";
import { CLIENT_VERSION, PROTOCOL_VERSION } from "./version";
export { CLIENT_VERSION, PROTOCOL_VERSION };
let socket: WebSocket | undefined,
  base = "",
  intent = false,
  retries = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
let last: { address: string; nickname: string } | undefined;
let lastJoined: { channel_id: string; password: string } | undefined;
const pending = new Map<
  string,
  {
    type: string;
    resolve: (p: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    started: number;
  }
>();
const actions: Record<string, string> = {
  JOIN_CHANNEL: "Rejoindre le salon",
  REFRESH_VOICE: "Reconnecter la voix",
  MOVE_USER: "Déplacer un utilisateur",
  CLAIM_OWNER: "Réclamer Owner",
  VOICE_STATE: "Modifier l’état vocal",
  LIST_DEVICE_ROLES: "Consulter les rôles",
  LIST_BANS: "Consulter les bans",
  LIST_OVERRIDES: "Consulter les permissions",
  CREATE_CHANNEL: "Créer un salon",
  UPDATE_CHANNEL: "Modifier un salon",
  DELETE_CHANNEL: "Supprimer un salon",
  MUTE_USER: "Couper un utilisateur",
};
const codes: Record<string, string> = {
  YOUTUBE_DISABLED: "YouTube désactivé par le serveur",
  STALE_ACTIVITY: "L’activité a changé : réessayez votre action",
  CHAT_DISABLED: "Chat désactivé par le serveur",
  CHAT_STORAGE_LIMIT: "Nombre maximal de conversations atteint",
  SCREEN_DISABLED: "Partage d’écran désactivé par le serveur",
  SCREEN_LIMIT: "Nombre maximal de partages atteint dans ce salon",
  SCREEN_ALREADY_ACTIVE: "Vous partagez déjà une source",
  DATABASE_ERROR: "Le serveur n’a pas pu enregistrer cette opération",
  PERMISSION_DENIED: "Permission refusée",
  INVALID_INPUT: "Saisie invalide",
  PROTECTED_ROLE: "Ce rôle est protégé",
  LOGS_UNAVAILABLE: "Journal du serveur indisponible",
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
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("La requête a expiré"));
    }, 10000);
    pending.set(id, {
      type,
      resolve,
      reject,
      timer: timeout,
      started: performance.now(),
    });
    try {
      transmit(type, payload, id);
    } catch (e) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(e);
    }
  }).then((result) => {
    if (type === "JOIN_CHANNEL") {
      const v = payload as { channel_id: string; password?: string };
      lastJoined = { channel_id: v.channel_id, password: v.password ?? "" };
    }
    if (type === "LEAVE_CHANNEL") lastJoined = undefined;
    return result;
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
  useStore.getState().set({
    status: retries ? "reconnecting" : "connecting",
    address,
    error: "",
    connectionRTT: null,
  });
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
        capabilities: ["voice", "chat", "screen_share"],
      });
    };
    ws.onmessage = async (e) => {
      if (ws !== socket) return;
      try {
        const m = JSON.parse(e.data) as Envelope;
        const p = m.payload as any;
        if (m.type === "SERVER_HELLO") {
          useStore.getState().set({ serverVersion: p.server_version });
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
        if (m.type === "PONG" && m.request_id) {
          const task = pending.get(m.request_id);
          if (task) {
            clearTimeout(task.timer);
            pending.delete(m.request_id);
            useStore.getState().set({
              connectionRTT: Math.round(performance.now() - task.started),
            });
            if (p.server_time)
              sampleYouTubeClock(
                p.server_time,
                performance.timeOrigin + task.started,
                performance.timeOrigin + performance.now(),
              );
            task.resolve(p);
          }
          return;
        }
        if (m.type === "PING") {
          transmit("PONG", {});
          void request("PING").catch(() => {});
          return;
        }
        if (m.type === "ERROR") {
          const task = m.request_id ? pending.get(m.request_id) : undefined;
          const action = task
            ? (actions[task.type] ?? task.type) + " : "
            : "Serveur : ";
          const error = new Error(
            action +
              (codes[p.code] ?? p.code) +
              (p.permission ? " (" + p.permission + ")" : ""),
          );
          if (p.code === "INCOMPATIBLE_VERSION")
            window.dispatchEvent(new Event("licra:check-update"));
          if (task) {
            clearTimeout(task.timer);
            task.reject(error);
            pending.delete(m.request_id!);
          } else {
            useStore.getState().set({ error: error.message });
          }
          if (!authenticated) {
            clearTimeout(timeout);
            // A dropped transport can leave the previous server session alive until its heartbeat expires.
            if (p.code !== "IDENTITY_CONNECTED" || retries === 0)
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
            if (task.type === "PING")
              useStore.getState().set({
                connectionRTT: Math.round(performance.now() - task.started),
              });
            task.resolve(p);
          }
        }
        applyEvent(m.type, p);
        applyChatEvent(m.type, p);
        screenEvent(m.type, p);
        if (m.type === "USER_MOVED" && p.id === useStore.getState().self_id) {
          lastJoined = p.channel_id
            ? {
                channel_id: p.channel_id,
                password:
                  lastJoined && lastJoined.channel_id === p.channel_id
                    ? lastJoined.password
                    : "",
              }
            : undefined;
        }
        youtubeEvent(m.type, p);
        if (
          m.type === "USER_MOVED" ||
          m.type === "VOICE_LEFT" ||
          m.type === "PERMISSIONS_UPDATED"
        )
          void syncYouTube().catch(report);
        if (
          m.type === "PERMISSIONS_UPDATED" ||
          m.type === "USER_MOVED" ||
          m.type === "SCREEN_STATE"
        )
          void syncScreens(base).catch(report);
        if (
          m.type === "PERMISSIONS_UPDATED" ||
          (m.type === "VOICE_STATE_UPDATED" &&
            p.id === useStore.getState().self_id)
        )
          void syncVoicePermissions().catch(report);
        if (m.type === "SNAPSHOT") {
          authenticated = true;
          clearTimeout(timeout);
          const restoring = retries > 0;
          retries = 0;
          if (
            restoring &&
            lastJoined &&
            p.channels.some((c: any) => c.id === lastJoined!.channel_id)
          )
            void request("JOIN_CHANNEL", lastJoined).catch(report);
          remember(address);
          const recentServers = {
            ...useStore.getState().recentServers,
            [address]: { name: p.server.name, nickname },
          };
          localStorage.setItem("recentServers", JSON.stringify(recentServers));
          useStore.getState().set({ recentServers });
          void request("PING").catch(() => {});
          resolve();
        }
        if (m.type === "VOICE_JOIN") {
          void closeScreens();
          await joinVoice(base + p.signaling_path, p);
          void syncScreens(base).catch(report);
        }
        if (m.type === "VOICE_LEFT") {
          await closeScreens();
          await leaveVoice();
        }
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
      void closeScreens();
      clearYouTube();
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
        useStore
          .getState()
          .set({ status: "reconnecting", connectionRTT: null });
        const delay = Math.min(30000, 1000 * 2 ** retries++);
        timer = setTimeout(() => {
          if (last) {
            useStore.getState().set({ status: "reconnecting" });
            void open(last.address, last.nickname).catch(report);
          }
        }, delay);
      }
    };
  });
}
export function disconnect() {
  lastJoined = undefined;
  intent = false;
  clearTimeout(timer);
  const old = socket;
  socket = undefined;
  old?.close();
  void leaveVoice();
  void closeScreens();
  clearYouTube();
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error("Déconnexion"));
  }
  pending.clear();
  useStore.getState().set({
    status: "disconnected",
    connectionRTT: null,
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

export function mediaBase() {
  return base;
}
