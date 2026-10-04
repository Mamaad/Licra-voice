import { useState, type ReactNode, type MouseEvent } from "react";
import { useStore, type Favorite } from "./store";
import type { Channel, User } from "./types";
import {
  devices,
  refreshSettings,
  setMasterVolume,
  toggleMute,
  toggleDeafen,
} from "./voice";
import { report } from "./control";
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
      <button className="sidebar-add" onClick={onAdd}>
        <Icon name="plus" />
        Ajouter un serveur
      </button>
      <div className="sidebar-version">LICRA · VOIX SANS COMPTE</div>
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
  return (
    <button
      className={`user-row ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${talking ? "talking" : ""}`}
      draggable={
        !!scope[
          user.id === s.self_id ? "channel.move_self" : "channel.move_others"
        ]
      }
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", user.id);
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
export function ChannelTree({
  onJoin,
  onContext,
  onUserContext,
  onMove,
  onCreate,
}: {
  onJoin: (c: Channel) => void;
  onContext: (e: MouseEvent, c: Channel) => void;
  onUserContext: (e: MouseEvent, u: User) => void;
  onMove: (id: string, c: Channel) => void;
  onCreate: (parent?: string) => void;
}) {
  const s = useStore(),
    [closed, setClosed] = useState<Record<string, boolean>>({}),
    [target, setTarget] = useState<{ id: string; valid: boolean } | null>(null),
    [selectedUser, setSelectedUser] = useState(""),
    [dragId, setDragId] = useState("");
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
              className={`channel-row ${s.selected === c.id ? "selected" : ""} ${target?.id === c.id ? (target.valid ? "drop-valid" : "drop-invalid") : ""} ${full ? "full" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                const self = s.self_id === dragId,
                  u = s.users.find((u) => u.id === dragId),
                  source =
                    s.channel_permissions[u?.channel_id ?? ""] ?? s.permissions;
                const valid =
                  !!u &&
                  !!source[
                    self ? "channel.move_self" : "channel.move_others"
                  ] &&
                  !!permission[
                    self ? "channel.move_self" : "channel.move_others"
                  ] &&
                  (!self || !!permission["channel.join"]) &&
                  (!full || !!permission["channel.join_full"]);
                setTarget({ id: c.id, valid });
                e.dataTransfer.dropEffect = valid ? "move" : "none";
              }}
              onDragLeave={() => setTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setTarget(null);
                onMove(e.dataTransfer.getData("text/plain"), c);
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
    <aside
      className="channel-tree"
      onDragStart={(e) => setDragId(e.dataTransfer.getData("text/plain"))}
      onDragEnd={() => {
        setDragId("");
        setTarget(null);
      }}
    >
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
    [deviceOpen, setDeviceOpen] = useState(false);
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
          <small>
            <StatusDot status={s.status} />
            {connectionLabels[s.status] ?? s.status}
            {s.connectionRTT !== null && s.status === "connected" && (
              <span className="technical"> · {s.connectionRTT} ms</span>
            )}
          </small>
        </div>
      </div>
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
