import { useEffect, useState, type ReactNode, type MouseEvent } from "react";
import { useStore, type Favorite } from "./store";
import type { Channel, User } from "./types";
import {
  devices,
  refreshSettings,
  setMasterVolume,
  toggleMute,
  toggleDeafen,
  voiceDiagnostics,
} from "./voice";
import { report, request } from "./control";
import { PrivateInbox } from "./ChatPanel";
import { useChat, openPrivate } from "./chat";
import { useScreens } from "./screen";
import { Modal } from "./Modal";
import {
  Icon,
  IconButton,
  Logo,
  Avatar,
  AudioStatusIcon,
  VoiceActivityIndicator,
  StatusDot,
  connectionLabels,
} from "./ui";
export function ServerListItem({
  server,
  active,
  onSelect,
  onRemove,
}: {
  server: Favorite;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const s = useStore();
  return (
    <div className={`server-list-item ${active ? "selected" : ""}`}>
      <button onClick={onSelect}>
        <span className="server-symbol">
          <Icon name="server" />
        </span>
        <span>
          <strong>{server.name}</strong>
          <small>
            {active ? (
              <>
                <StatusDot status={s.status} />
                {s.status === "connected"
                  ? `${s.users.length} en ligne`
                  : connectionLabels[s.status]}
              </>
            ) : (
              "Connexion directe"
            )}
          </small>
        </span>
      </button>
      {onRemove && (
        <IconButton
          icon="close"
          label={`Retirer ${server.name} des favoris`}
          onClick={onRemove}
        />
      )}
    </div>
  );
}
export function ServerSidebar({
  view,
  setView,
  onSettings,
  onChoose,
  onAdd,
}: {
  view: string;
  setView: (v: string) => void;
  onSettings: () => void;
  onChoose: (f: Favorite) => void;
  onAdd: () => void;
}) {
  const s = useStore();
  return (
    <aside className="server-sidebar">
      <Logo />
      <nav className="global-nav">
        <button
          className={view === "connection" ? "selected" : ""}
          onClick={() => setView("connection")}
        >
          <Icon name="connect" />
          Connexion
        </button>
        <button
          className={view === "servers" ? "selected" : ""}
          onClick={() => setView("servers")}
        >
          <Icon name="server" />
          Serveurs
        </button>
        <button onClick={onSettings}>
          <Icon name="settings" />
          Paramètres
        </button>
      </nav>
      <div className="sidebar-section-title">
        <span>Serveurs favoris</span>
        <IconButton
          icon="plus"
          label="Ajouter un serveur favori"
          onClick={onAdd}
        />
      </div>
      <div className="server-list">
        {s.status === "connected" &&
          !s.favorites.some((f) => f.address === s.address) && (
            <ServerListItem
              server={{
                address: s.address,
                name: s.server.name,
                nickname:
                  s.users.find((u) => u.id === s.self_id)?.nickname ?? "",
              }}
              active
              onSelect={() => setView("channels")}
            />
          )}
        {s.favorites.map((f) => (
          <ServerListItem
            key={f.address}
            server={f}
            active={s.address === f.address && s.status !== "disconnected"}
            onSelect={() => onChoose(f)}
            onRemove={() => {
              const favorites = s.favorites.filter(
                (x) => x.address !== f.address,
              );
              localStorage.setItem("favorites", JSON.stringify(favorites));
              s.set({ favorites });
            }}
          />
        ))}
        {!s.favorites.length && (
          <p className="sidebar-empty">
            Vos serveurs favoris restent accessibles ici.
          </p>
        )}
      </div>
      <PrivateInbox />
      <button className="sidebar-add" onClick={onAdd}>
        <Icon name="plus" />
        Ajouter un serveur
      </button>
    </aside>
  );
}
export function UserRow({
  user,
  onContext,
  onSelect,
  selected = false,
  compact = false,
}: {
  user: User;
  onContext: (e: MouseEvent, user: User) => void;
  onSelect?: () => void;
  selected?: boolean;
  compact?: boolean;
}) {
  const s = useStore(),
    talking = s.talking.includes(user.id),
    scope = s.channel_permissions[user.channel_id] ?? s.permissions;
  const screen = useScreens();
  return (
    <button
      onDoubleClick={() => {
        if (user.id !== s.self_id && s.permissions["chat.private.send"])
          openPrivate(user.fingerprint, user.nickname);
      }}
      className={`user-row ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${talking ? "talking" : ""}`}
      draggable={user.id === s.self_id || !!scope["channel.move_others"]}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", user.id);
        e.dataTransfer.setData("application/x-licra-user", user.id);
        e.dataTransfer.effectAllowed = "move";
        e.currentTarget.classList.add("dragging");
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
      onClick={onSelect}
      onContextMenu={(e) => onContext(e, user)}
    >
      <Avatar name={user.nickname} identity={user.fingerprint} />
      <span className="user-name">
        {user.nickname}
        {user.id === s.self_id && <small>vous</small>}
      </span>
      {screen.shares.some((t) => t.user_id === user.id) && (
        <span title="Partage d’écran actif" aria-label="Partage d’écran actif">
          <Icon name="screen"/>
        </span>
      )}
      <VoiceActivityIndicator active={talking} />
      <AudioStatusIcon user={user} />
      <span
        className="row-more"
        onClick={(e) => {
          e.stopPropagation();
          onContext(e, user);
        }}
      >
        <Icon name="more" />
      </span>
    </button>
  );
}
export type DragItem = { kind: "user" | "channel"; id: string };
export type DropPosition = "before" | "inside" | "after";
export function channelDropPlan(
  channels: Channel[],
  id: string,
  target: Channel | null,
  position: DropPosition,
): Channel[] | null {
  const moved = channels.find((c) => c.id === id);
  if (!moved || target?.id === id) return null;
  const parent = target
    ? position === "inside"
      ? target.id
      : target.parent_id
    : null;
  let cursor = parent;
  while (cursor) {
    if (cursor === id) return null;
    const c = channels.find((c) => c.id === cursor);
    if (!c) return null;
    if (moved.is_permanent && !c.is_permanent) return null;
    cursor = c.parent_id;
  }
  const siblings = channels
    .filter((c) => c.id !== id && c.parent_id === parent)
    .sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
  const index =
    target && position !== "inside"
      ? siblings.findIndex((c) => c.id === target.id) +
        (position === "after" ? 1 : 0)
      : siblings.length;
  const before = siblings[index - 1]?.sort_order,
    after = siblings[index]?.sort_order;
  const order =
    before === undefined
      ? (after ?? 0) - 1024
      : after === undefined
        ? before + 1024
        : Math.floor((before + after) / 2);
  const next = { ...moved, parent_id: parent, sort_order: order };
  if (
    (before === undefined || order > before) &&
    (after === undefined || order < after) &&
    order >= -2147483648 &&
    order <= 2147483647
  )
    return [next];
  siblings.splice(index, 0, next);
  return siblings
    .map((c, i) => ({ ...c, sort_order: i * 1024 }))
    .filter(
      (c) =>
        c.id === id ||
        c.sort_order !== channels.find((x) => x.id === c.id)?.sort_order,
    );
}
export function ChannelTree({
  onJoin,
  onContext,
  onUserContext,
  onMove,
  onCreate,
  drag,
  onChannelMove,
}: {
  onJoin: (c: Channel) => void;
  onContext: (e: MouseEvent, c: Channel) => void;
  onUserContext: (e: MouseEvent, u: User) => void;
  onMove: (id: string, c: Channel) => void;
  onCreate: (parent?: string) => void;
  drag: DragItem | null;
  onChannelMove: (
    id: string,
    target: Channel | null,
    position: DropPosition,
  ) => void;
}) {
  const chat = useChat();
  const s = useStore(),
    [closed, setClosed] = useState<Record<string, boolean>>({}),
    [target, setTarget] = useState<{
      id: string;
      valid: boolean;
      position: DropPosition;
    } | null>(null),
    [selectedUser, setSelectedUser] = useState("");
  function canDrop(c: Channel | null, position: DropPosition) {
    if (!drag) return false;
    if (drag.kind === "channel") {
      const plan = channelDropPlan(s.channels, drag.id, c, position);
      return (
        !!plan &&
        plan.every(
          (item) =>
            !!s.channel_permissions[item.id]?.["channel.edit"] &&
            !!(
              item.parent_id
                ? s.channel_permissions[item.parent_id]
                : s.permissions
            )?.["channel.edit"],
        )
      );
    }
    if (!c) return false;
    const u = s.users.find((u) => u.id === drag.id);
    if (!u || u.channel_id === c.id) return false;
    const self = u.id === s.self_id,
      source = s.channel_permissions[u.channel_id] ?? s.permissions,
      p = s.channel_permissions[c.id] ?? {};
    return (
      !!p[self ? "channel.move_self" : "channel.move_others"] &&
      (self || !!source["channel.move_others"]) &&
      (!self || !!p["channel.join"]) &&
      (!c.max_users ||
        s.users.filter((u) => u.channel_id === c.id).length < c.max_users ||
        !!p["channel.join_full"]) &&
      (self || !c.has_password || !!p["channel.join_password_bypass"])
    );
  }
  function tree(parent: string | null, depth = 0): ReactNode {
    if (depth > 64) return null;
    return s.channels
      .filter((c) => c.parent_id === parent)
      .sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      )
      .map((c) => {
        const users = s.users.filter((u) => u.channel_id === c.id),
          child = s.channels.some((x) => x.parent_id === c.id),
          permission = s.channel_permissions[c.id] ?? {},
          full = !!c.max_users && users.length >= c.max_users;
        return (
          <div className="channel-branch" key={c.id}>
            <div
              className={`channel-row ${s.selected === c.id ? "selected" : ""} ${target?.id === c.id ? `${target.valid ? "drop-valid" : "drop-invalid"} drop-${target.position}` : ""} ${full ? "full" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect(),
                  y = (e.clientY - rect.top) / rect.height;
                const position: DropPosition =
                  drag?.kind === "channel"
                    ? y < 0.25
                      ? "before"
                      : y > 0.75
                        ? "after"
                        : "inside"
                    : "inside";
                const valid = canDrop(c, position);
                setTarget({ id: c.id, valid, position });
                e.dataTransfer.dropEffect = valid ? "move" : "none";
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const position =
                  target?.id === c.id ? target.position : "inside";
                if (canDrop(c, position) && drag) {
                  if (drag.kind === "user") onMove(drag.id, c);
                  else onChannelMove(drag.id, c, position);
                }
                setTarget(null);
              }}
              onContextMenu={(e) => onContext(e, c)}
            >
              <IconButton
                icon="chevron"
                className={closed[c.id] ? "" : "expanded"}
                label={`${closed[c.id] ? "Déplier" : "Replier"} ${c.name}`}
                onClick={() => setClosed({ ...closed, [c.id]: !closed[c.id] })}
              />
              <button
                draggable={!!permission["channel.edit"]}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-licra-channel", c.id);
                  e.dataTransfer.setData("text/plain", c.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                className="channel-label"
                onClick={() => s.set({ selected: c.id })}
                onDoubleClick={() => onJoin(c)}
              >
                <Icon name={child ? "settings" : "channel"} />
                <strong>{c.name}</strong>
                <span className="capacity">
                  {users.length}
                  {c.max_users ? `/${c.max_users}` : ""}
                </span>
                {c.has_password && <Icon name="lock" />}
                {!!chat.threads.find((t) => t.channel_id === c.id)?.unread && (
                  <span className="unread-badge">
                    {chat.threads.find((t) => t.channel_id === c.id)?.unread}
                  </span>
                )}
              </button>
              {permission["channel.create"] && (
                <IconButton
                  icon="plus"
                  label={`Créer un sous-salon de ${c.name}`}
                  className="row-add"
                  onClick={() => onCreate(c.id)}
                />
              )}
            </div>
            {!closed[c.id] && (
              <div className="channel-children">
                {users.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    compact
                    selected={selectedUser === u.id}
                    onSelect={() => setSelectedUser(u.id)}
                    onContext={onUserContext}
                  />
                ))}
                {tree(c.id, depth + 1)}
              </div>
            )}
          </div>
        );
      });
  }
  return (
    <aside className="channel-tree" onDragEnd={() => setTarget(null)}>
      <div className="tree-heading">
        <span>
          <Icon name="channel" />
          SALONS VOCAUX
        </span>
        {s.permissions["channel.create"] && (
          <IconButton
            icon="plus"
            label="Créer un salon"
            onClick={() => onCreate()}
          />
        )}
      </div>
      <div className="tree-scroll">
        {tree(null)}
        {drag?.kind === "channel" && (
          <div
            className={`root-drop ${canDrop(null, "inside") ? "" : "drop-invalid"}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = canDrop(null, "inside")
                ? "move"
                : "none";
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (canDrop(null, "inside"))
                onChannelMove(drag.id, null, "inside");
              setTarget(null);
            }}
          >
            Déplacer à la racine
          </div>
        )}
        {!!s.users.filter((u) => !u.channel_id).length && (
          <section className="unassigned">
            <h3>Hors salon</h3>
            {s.users
              .filter((u) => !u.channel_id)
              .map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  compact
                  onContext={onUserContext}
                />
              ))}
          </section>
        )}
      </div>
      <div className="tree-footnote">
        <StatusDot status={s.status} />
        {s.users.length} utilisateur{s.users.length > 1 ? "s" : ""} · Opus
      </div>
    </aside>
  );
}
export function BottomAudioBar({ onSettings }: { onSettings: () => void }) {
  const s = useStore(),
    self = s.users.find((u) => u.id === s.self_id),
    [list, setList] = useState<MediaDeviceInfo[]>([]),
    [deviceOpen, setDeviceOpen] = useState(false),
    [statistics, showStatistics] = useState(false);
  const level = Math.max(
    0,
    Math.min(
      1,
      (20 * Math.log10(Math.max(0.001, s.microphoneLevel)) + 60) / 60,
    ),
  );
  async function chooseDevice(id: string) {
    s.saveSettings({ input: id });
    await refreshSettings({ input: id });
    setDeviceOpen(false);
  }
  return (
    <footer className="audio-bar">
      <div className="identity-summary">
        <Avatar
          name={self?.nickname || localStorage.getItem("nickname") || "Vous"}
          identity={self?.fingerprint}
          large
        />
        <div>
          <strong>
            {self?.nickname ||
              localStorage.getItem("nickname") ||
              "Votre identité"}
          </strong>
          <button
            className="connection-status"
            disabled={s.status !== "connected"}
            title="Statistiques de connexion vocale"
            onClick={() => showStatistics(true)}
          >
            <StatusDot status={s.status} />
            {connectionLabels[s.status] ?? s.status}
            {s.connectionRTT !== null && s.status === "connected" && (
              <span className="technical"> · {s.connectionRTT} ms</span>
            )}
          </button>
        </div>
      </div>
      {statistics && <VoiceStatistics onClose={() => showStatistics(false)} />}
      <div className="audio-controls">
        <div className="input-control">
          <div
            className="input-level"
            aria-label="Niveau du microphone"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
          >
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} className={level > (i + 1) / 11 ? "lit" : ""} />
            ))}
          </div>
          <Icon name={s.muted || s.deafened ? "micOff" : "mic"} />
          <IconButton
            icon="chevron"
            className="device-chevron"
            label="Choisir le microphone"
            onClick={() => {
              setDeviceOpen(!deviceOpen);
              void devices().then(setList).catch(report);
            }}
          />
          {deviceOpen && (
            <div className="device-popover">
              <label>
                Microphone
                <select
                  value={s.settings.input}
                  onChange={(e) =>
                    void chooseDevice(e.target.value).catch(report)
                  }
                >
                  <option value="">Par défaut</option>
                  {list
                    .filter((d) => d.kind === "audioinput")
                    .map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${i + 1}`}
                      </option>
                    ))}
                </select>
              </label>
              <button onClick={onSettings}>Options audio complètes</button>
            </div>
          )}
        </div>
        <IconButton
          icon={s.muted || s.deafened ? "micOff" : "mic"}
          label={s.muted ? "Réactiver le micro" : "Couper le micro"}
          className={
            s.muted || s.deafened ? "audio-toggle muted" : "audio-toggle"
          }
          aria-pressed={s.muted || s.deafened}
          onClick={() => void toggleMute().catch(report)}
        />
        <IconButton
          icon="headphones"
          label={s.deafened ? "Réactiver le son" : "Couper le son"}
          className={s.deafened ? "audio-toggle muted" : "audio-toggle"}
          aria-pressed={s.deafened}
          onClick={() => void toggleDeafen().catch(report)}
        />
        <IconButton
          icon="settings"
          label="Paramètres audio"
          className="audio-toggle"
          onClick={onSettings}
        />
        <label className="master-volume">
          <Icon name="volume" />
          <input
            aria-label="Volume général"
            type="range"
            min="0"
            max="100"
            value={s.masterVolume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
          />
          <output>{s.masterVolume}%</output>
        </label>
      </div>
    </footer>
  );
}

function VoiceStatistics({ onClose }: { onClose: () => void }) {
  const s = useStore(),
    [stats, setStats] = useState<Awaited<
      ReturnType<typeof voiceDiagnostics>
    > | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await voiceDiagnostics();
        if (alive) {
          setStats(result);
          setError("");
        }
        await request("PING");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const fields = [
    ["RTT contrôle", s.connectionRTT == null ? null : `${s.connectionRTT} ms`],
    ["RTT média", stats?.rtt_ms == null ? null : `${stats.rtt_ms} ms`],
    [
      "Jitter réception",
      stats?.jitter_ms == null ? null : `${stats.jitter_ms} ms`,
    ],
    [
      "Paquets perdus (réception)",
      stats?.packet_loss_percent == null
        ? null
        : `${stats.packet_loss_percent} %`,
    ],
    [
      "Débit reçu",
      stats?.receive_kbps == null ? null : `${stats.receive_kbps} kb/s`,
    ],
    [
      "Débit envoyé",
      stats?.send_kbps == null ? null : `${stats.send_kbps} kb/s`,
    ],
    ["Transport", stats?.transport?.toUpperCase()],
    ["Codec", stats?.codec],
    ["Paquets reçus", stats?.packets_received],
    ["Paquets perdus", stats?.packets_lost],
  ];
  return (
    <Modal title="Statistiques vocales" onClose={onClose}>
      <p>
        {stats?.connected
          ? "Mesures WebRTC actualisées chaque seconde."
          : "Rejoignez un salon vocal pour mesurer le transport média."}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="info-grid voice-statistics">
        {fields.map(([label, value]) => (
          <div key={label}>
            {label}
            <strong>{value ?? "Non mesuré"}</strong>
          </div>
        ))}
      </div>
    </Modal>
  );
}
