import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type MouseEvent } from "react";
import {
  connect,
  disconnect,
  request,
  report,
  changeNickname,
} from "./control";
import { useStore, type Favorite } from "./store";
import { setVolume, localVolumes } from "./voice";
import type { Channel, User } from "./types";
import { Settings } from "./Settings";
import { Updater } from "./Updater";
import { Admin, ChannelEditor } from "./Admin";
import { Modal, ActionDialog, promptDialog, confirmDialog } from "./Modal";
import { Icon, IconButton, Avatar, StatusDot, connectionLabels } from "./ui";
import {
  ServerSidebar,
  ChannelTree,
  BottomAudioBar,
  UserRow,
  channelDropPlan,
  type DragItem,
  type DropPosition,
} from "./Shell";
import { ChatPanel } from "./ChatPanel";
import { ChannelActivities } from "./YouTubePanel";
import { useChat, openPrivate } from "./chat";
import { ContextMenu } from "./ContextMenu";
import { CLIENT_VERSION } from "./version";
export function App() {
  const chat = useChat();
  const s = useStore();
  const [address, setAddress] = useState(s.history[0] ?? ""),
    [nickname, setNickname] = useState(localStorage.getItem("nickname") ?? ""),
    [view, setView] = useState("connection"),
    [settings, showSettings] = useState(false),
    [admin, showAdmin] = useState(false),
    [drag, setDrag] = useState<DragItem | null>(null),
    [sort, setSort] = useState("name");
  const [editor, setEditor] = useState<{
      channel?: Channel;
      parent?: string;
    } | null>(null),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      user?: User;
      channel?: Channel;
    } | null>(null),
    [profile, setProfile] = useState<User | null>(null);
  useEffect(() => {
    void invoke("identity_public").catch(report);
  }, []);
  useEffect(() => {
    if (s.status === "connected") setView("channels");
  }, [s.status]);
  const self = s.users.find((u) => u.id === s.self_id),
    selected = s.channels.find((c) => c.id === s.selected),
    permissions = s.channel_permissions[selected?.id ?? ""] ?? s.permissions;
  const members = s.users
    .filter((u) => u.channel_id === selected?.id)
    .sort((a, b) =>
      sort === "voice"
        ? Number(s.talking.includes(b.id)) - Number(s.talking.includes(a.id)) ||
          a.nickname.localeCompare(b.nickname)
        : a.nickname.localeCompare(b.nickname),
    );
  const profiles = {
    eco: "Économique",
    standard: "Standard",
    high: "Haute qualité",
  };
  async function join(c: Channel) {
    const allowed = s.channel_permissions[c.id] ?? {};
    if (!allowed["channel.join"] || !allowed["channel.move_self"]) {
      report(
        new Error(
          "Vous ne pouvez pas rejoindre ce salon avec vos permissions actuelles.",
        ),
      );
      return;
    }
    const password =
      c.has_password && !allowed["channel.join_password_bypass"]
        ? await promptDialog("Mot de passe du salon", "", true)
        : "";
    if (password === null) return;
    await request("JOIN_CHANNEL", { channel_id: c.id, password }).catch(report);
    setMenu(null);
  }
  function move(id: string, c: Channel) {
    if (id === s.self_id) {
      void join(c);
      return;
    }
    const u = s.users.find((u) => u.id === id);
    if (!u) return;
    const source = s.channel_permissions[u.channel_id] ?? s.permissions;
    if (
      !source["channel.move_others"] ||
      !s.channel_permissions[c.id]?.["channel.move_others"]
    ) {
      report(
        new Error(
          "Déplacement refusé : permission requise dans le salon de départ et d’arrivée.",
        ),
      );
      return;
    }
    void request("MOVE_USER", { user_id: id, channel_id: c.id })
      .then(() => setMenu(null))
      .catch(report);
  }
  async function reorderChannel(
    id: string,
    target: Channel | null,
    position: DropPosition,
  ) {
    const plan = channelDropPlan(
      useStore.getState().channels,
      id,
      target,
      position,
    );
    if (!plan) return;
    try {
      for (const c of plan) await request("UPDATE_CHANNEL", c);
    } catch (e) {
      report(e);
    }
    setDrag(null);
  }
  function context(e: MouseEvent, value: User | Channel) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      ...("fingerprint" in value ? { user: value } : { channel: value }),
    });
  }
  function choose(f: Favorite) {
    setAddress(f.address);
    setNickname(f.nickname || nickname);
    setView(
      s.address === f.address && s.status === "connected"
        ? "channels"
        : "connection",
    );
  }
  async function addFavorite() {
    if (!address.trim()) {
      report(new Error("Renseignez d’abord l’adresse du serveur."));
      return;
    }
    const name = await promptDialog(
      "Nom du serveur favori",
      s.address === address ? s.server.name : address,
    );
    if (!name) return;
    const favorites = [
      ...s.favorites.filter((f) => f.address !== address),
      { name, address, nickname },
    ];
    localStorage.setItem("favorites", JSON.stringify(favorites));
    s.set({ favorites });
  }
  function connection(target = address, name = nickname) {
    localStorage.setItem("nickname", name);
    void connect(target, name).catch((e) => {
      report(e);
      s.set({ status: "failed" });
    });
  }
  async function moderation(u: User, ban = false) {
    const reason = await promptDialog(
      ban
        ? `Motif du ban de ${u.nickname}`
        : `Motif de l’expulsion de ${u.nickname}`,
    );
    if (reason === null) return;
    if (!ban) {
      if (await confirmDialog(`Expulser ${u.nickname} du serveur ?`))
        await request("KICK_USER", { user_id: u.id, reason }).catch(report);
    } else {
      const minutes = await promptDialog(
        "Durée en minutes — vide pour un ban permanent",
      );
      if (minutes === null) return;
      const n = Number(minutes);
      if (minutes && (!Number.isFinite(n) || n <= 0)) {
        report(new Error("Durée invalide"));
        return;
      }
      if (
        await confirmDialog(
          `Bannir ${u.nickname} ${minutes ? `pendant ${n} minutes` : "définitivement"} ?`,
        )
      )
        await request("BAN_USER", {
          user_id: u.id,
          reason,
          expires_at: minutes
            ? new Date(Date.now() + n * 60000).toISOString()
            : null,
        }).catch(report);
    }
    setMenu(null);
  }
  const recent = [
    ...new Set([...s.history, ...s.favorites.map((f) => f.address)]),
  ];
  const menuPermissions = menu?.user
    ? (s.channel_permissions[menu.user.channel_id] ?? s.permissions)
    : menu?.channel
      ? (s.channel_permissions[menu.channel.id] ?? {})
      : {};
  const native = "__TAURI_INTERNALS__" in window;
  return (
    <main
      onDragStart={(e) => {
        const channel = e.dataTransfer.getData("application/x-licra-channel"),
          user = e.dataTransfer.getData("application/x-licra-user");
        if (channel || user)
          setDrag({ kind: channel ? "channel" : "user", id: channel || user });
      }}
      onDragEnd={() => setDrag(null)}
      className={`app-shell ${s.status === "connected" && view === "channels" ? "in-server" : ""}`}
    >
      <ServerSidebar
        view={view}
        setView={setView}
        onSettings={() => showSettings(true)}
        onChoose={choose}
        onAdd={() => {
          setView("connection");
          setAddress("");
        }}
      />
      <header className="topbar" data-tauri-drag-region>
        <div className="topbar-server">
          <span className="server-symbol">
            <Icon name="users" />
          </span>
          <strong>
            {s.status === "connected" ? s.server.name : "Licra Voice"}
          </strong>
          {s.status === "connected" && (
            <span className="online-count">
              <StatusDot status="connected" />
              {s.users.length} en ligne
            </span>
          )}
        </div>
        <div className="topbar-actions">
          {s.status === "connected" && (
            <>
              {s.permissions["role.view"] && (
                <IconButton
                  icon="shield"
                  label="Paramètres du serveur"
                  onClick={() => showAdmin(true)}
                />
              )}
              <IconButton
                icon="logout"
                label="Déconnecter du serveur"
                onClick={async () => {
                  if (
                    await confirmDialog(
                      "Quitter ce serveur et la conversation vocale ?",
                    )
                  ) {
                    disconnect();
                    setView("connection");
                  }
                }}
              />
            </>
          )}
          <IconButton
            icon="download"
            label="Mettre à jour Licra"
            onClick={() =>
              window.dispatchEvent(new Event("licra:check-update"))
            }
          />
          {native && (
            <div className="window-controls">
              <button
                aria-label="Réduire"
                onClick={() => void getCurrentWindow().minimize().catch(report)}
              >
                —
              </button>
              <button
                aria-label="Agrandir ou restaurer"
                onClick={() =>
                  void getCurrentWindow().toggleMaximize().catch(report)
                }
              >
                <svg width="12" height="12">
                  <rect
                    x="1"
                    y="1"
                    width="10"
                    height="10"
                    fill="none"
                    stroke="currentColor"
                  />
                </svg>
              </button>
              <IconButton
                icon="close"
                label="Fermer Licra"
                onClick={() => void getCurrentWindow().close().catch(report)}
              />
            </div>
          )}
        </div>
      </header>
      {s.error && (
        <div className="error-banner" role="alert">
          <Icon name="info" />
          <span>{s.error}</span>
          <IconButton
            icon="close"
            label="Fermer le message"
            onClick={() => s.set({ error: "" })}
          />
        </div>
      )}
      <section className="workspace">
        {s.status === "connected" && view === "channels" ? (
          <>
            <ChannelTree
              drag={drag}
              onChannelMove={reorderChannel}
              onJoin={(c) => void join(c)}
              onContext={context}
              onUserContext={context}
              onMove={move}
              onCreate={(parent) => setEditor({ parent })}
            />
            <article className="channel-content">
              {selected ? (
                <>
                  <div className="channel-banner">
                    <div className="channel-banner-actions">
                      {permissions["channel.edit"] && (
                        <button
                          onClick={() => setEditor({ channel: selected })}
                        >
                          <Icon name="edit" />
                          Modifier le salon
                        </button>
                      )}
                    </div>
                    <div className="channel-title">
                      <Icon name="channel" />
                      <h1>{selected.name}</h1>
                      {selected.has_password && <Icon name="lock" />}
                    </div>
                    <p>
                      {s.channels.find((c) => c.id === selected.parent_id)
                        ?.name ?? s.server.name}
                    </p>
                  </div>
                  <div className="channel-details">
                    <section className="description-panel">
                      <p>
                        {selected.description ||
                          "Un espace pour discuter. Rejoignez le salon pour commencer la conversation."}
                      </p>
                      <div className="channel-actions">
                        <button
                          className="primary"
                          disabled={
                            !permissions["channel.join"] ||
                            !permissions["channel.move_self"] ||
                            self?.channel_id === selected.id
                          }
                          onClick={() => void join(selected)}
                        >
                          <Icon name="connect" />
                          {self?.channel_id === selected.id
                            ? "Vous êtes dans ce salon"
                            : "Rejoindre le salon"}
                        </button>
                        {self?.channel_id && (
                          <button
                            onClick={() =>
                              void request("LEAVE_CHANNEL").catch(report)
                            }
                          >
                            Quitter le vocal
                          </button>
                        )}
                      </div>
                    </section>
                    <div className="channel-stat-strip">
                      <div>
                        <Icon name="users" />
                        <span>
                          Membres
                          <strong>
                            {
                              s.users.filter(
                                (u) => u.channel_id === selected.id,
                              ).length
                            }
                            {selected.max_users
                              ? ` / ${selected.max_users}`
                              : ""}
                          </strong>
                        </span>
                      </div>
                      <div>
                        <Icon name="activity" />
                        <span>
                          Profil audio
                          <strong>{profiles[selected.audio_profile]}</strong>
                          <small>48 kHz · Opus mono</small>
                        </span>
                      </div>
                      <div>
                        <Icon name="shield" />
                        <span>
                          Conversation<strong>WebRTC chiffré</strong>
                          <small>Serveur auto-hébergé</small>
                        </span>
                      </div>
                    </div>
                    <ChannelActivities channelId={selected.id} />
                    <div className="conversation-layout">
                      <ChatPanel
                        key={chat.privatePeer?.fingerprint ?? selected.id}
                        channelId={chat.privatePeer ? undefined : selected.id}
                        peer={chat.privatePeer ?? undefined}
                        onClose={
                          chat.privatePeer
                            ? () => chat.set({ privatePeer: null })
                            : undefined
                        }
                      />
                      <div className="conversation-members">
                        <div className="members-heading">
                          <h2>Membres ({members.length})</h2>
                          <select
                            aria-label="Trier les membres"
                            value={sort}
                            onChange={(e) => setSort(e.target.value)}
                          >
                            <option value="name">Trier : pseudonyme</option>
                            <option value="voice">
                              Trier : activité vocale
                            </option>
                          </select>
                        </div>
                        <div className="member-list">
                          {members.map((u) => (
                            <UserRow
                              key={u.id}
                              user={u}
                              onSelect={() => setProfile(u)}
                              onContext={context}
                            />
                          ))}
                          {!members.length && (
                            <div className="empty-state">
                              <Icon name="users" />
                              <h3>La conversation commence ici</h3>
                              <p>
                                Rejoignez le salon ou invitez vos amis avec
                                l’adresse du serveur.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Icon name="channel" />
                  <h1>Votre serveur vocal</h1>
                  <p>Sélectionnez un salon dans l’arborescence.</p>
                </div>
              )}
            </article>
          </>
        ) : (
          <article className="connection-page">
            <div className="connection-hero">
              <p className="eyebrow">CONNEXION DIRECTE · SANS COMPTE</p>
              <h1>
                {view === "servers" ? "Vos serveurs" : "Connecter à un serveur"}
              </h1>
              <p>
                Rejoignez votre communauté en quelques secondes.
                <br />
                Aucun compte, aucun mot de passe utilisateur.
                <br />
                Une connexion directe à votre serveur vocal.
              </p>
              {view !== "servers" && (
                <form
                  className="connection-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    connection();
                  }}
                >
                  <label>
                    Adresse du serveur
                    <div className="input-with-icon">
                      <Icon name="connect" />
                      <input
                        required
                        aria-describedby="address-help"
                        list="server-history"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="voice.example.com:64738"
                      />
                      <IconButton
                        icon="close"
                        label="Effacer l’adresse"
                        onClick={() => setAddress("")}
                      />
                    </div>
                    <small id="address-help">
                      Adresse IP ou nom de domaine, suivi du port.
                    </small>
                  </label>
                  <datalist id="server-history">
                    {s.history.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                  <label>
                    Pseudo
                    <div className="input-with-icon">
                      <Icon name="user" />
                      <input
                        required
                        maxLength={32}
                        aria-describedby="nickname-help"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="Votre pseudonyme"
                      />
                      <IconButton
                        icon="close"
                        label="Effacer le pseudo"
                        onClick={() => setNickname("")}
                      />
                    </div>
                    <small id="nickname-help">
                      Votre pseudo sera visible par les autres utilisateurs sur
                      le serveur.
                    </small>
                  </label>
                  <button
                    className="primary connect-button"
                    disabled={["connecting", "reconnecting"].includes(s.status)}
                  >
                    <Icon name="connect" />
                    {["connecting", "reconnecting"].includes(s.status)
                      ? connectionLabels[s.status]
                      : "Connexion"}
                  </button>
                  <button
                    type="button"
                    className="favorite-current"
                    onClick={() => void addFavorite()}
                  >
                    <Icon name="star" />
                    Enregistrer dans les favoris
                  </button>
                </form>
              )}
            </div>
            <section className="recent-section">
              <div className="members-heading">
                <h2>Serveurs récents</h2>
                <span className="muted-text">
                  Connexion sans compte central
                </span>
              </div>
              <div className="server-cards">
                {recent.map((a) => {
                  const f = s.favorites.find((f) => f.address === a),
                    r = s.recentServers[a],
                    name = f?.name ?? r?.name ?? a,
                    nick = f?.nickname ?? r?.nickname ?? nickname,
                    active = s.status === "connected" && s.address === a;
                  return (
                    <section className="server-card" key={a}>
                      <div className="server-card-heading">
                        <span className="server-symbol">
                          <Icon name="server" />
                        </span>
                        <div>
                          <h3>{name}</h3>
                          <small>
                            {active ? (
                              <>
                                <StatusDot status="connected" />
                                {s.users.length} en ligne
                              </>
                            ) : (
                              "Serveur enregistré"
                            )}
                          </small>
                        </div>
                        {f && <Icon name="star" className="warning-text" />}
                      </div>
                      <p>
                        <Icon name="server" />
                        {a}
                      </p>
                      <p>
                        <Icon name="user" />
                        {nick || "Choisissez un pseudo"}
                      </p>
                      <button
                        onClick={() => {
                          setAddress(a);
                          setNickname(nick);
                          if (nick) connection(a, nick);
                          else setView("connection");
                        }}
                      >
                        <Icon name="connect" />
                        Connexion rapide
                      </button>
                    </section>
                  );
                })}
                {!recent.length && (
                  <div className="empty-state">
                    <Icon name="server" />
                    <h3>Votre première communauté</h3>
                    <p>Les serveurs rejoints apparaîtront ici.</p>
                  </div>
                )}
              </div>
            </section>
            <small className="connection-version">
              Licra {CLIENT_VERSION} · Identité Ed25519 conservée sur votre
              appareil
            </small>
          </article>
        )}
      </section>
      <BottomAudioBar onSettings={() => showSettings(true)} />
      {admin && <Admin onClose={() => showAdmin(false)} />}
      {editor && <ChannelEditor {...editor} onClose={() => setEditor(null)} />}
      {settings && <Settings onClose={() => showSettings(false)} />}
      {profile && (
        <Modal
          title="Informations utilisateur"
          onClose={() => setProfile(null)}
        >
          <div className="profile-heading">
            <Avatar
              name={profile.nickname}
              identity={profile.fingerprint}
              large
            />
            <h3>{profile.nickname}</h3>
            <StatusDot status="connected" />
          </div>
          <p>
            Salon :{" "}
            {s.channels.find((c) => c.id === profile.channel_id)?.name ??
              "Hors salon"}
          </p>
          <label>
            Identité cryptographique
            <code className="fingerprint">{profile.fingerprint}</code>
          </label>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(profile.fingerprint)
                .catch(report)
            }
          >
            <Icon name="copy" />
            Copier l’identité
          </button>
        </Modal>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.user ? (
            <>
              <div className="context-profile">
                <Avatar
                  name={menu.user.nickname}
                  identity={menu.user.fingerprint}
                />
                <div>
                  <strong>{menu.user.nickname}</strong>
                  <small>
                    <StatusDot status="connected" />
                    En ligne
                  </small>
                </div>
              </div>
              {menu.user.id !== s.self_id && (
                <>
                  <label className="context-volume">
                    <span>
                      <Icon name="volume" />
                      Volume local
                      <output>
                        {s.volumes[menu.user.fingerprint] ?? 100}%
                      </output>
                    </span>
                    <input
                      aria-label={`Volume de ${menu.user.nickname}`}
                      type="range"
                      min="0"
                      max="200"
                      value={s.volumes[menu.user.fingerprint] ?? 100}
                      onChange={(e) =>
                        setVolume(
                          menu.user!.fingerprint,
                          Number(e.target.value),
                        )
                      }
                    />
                  </label>
                  <button
                    onClick={() => {
                      const u = menu.user!;
                      s.set({
                        localMuted: {
                          ...s.localMuted,
                          [u.fingerprint]: !s.localMuted[u.fingerprint],
                        },
                      });
                      localVolumes();
                    }}
                  >
                    <Icon name="micOff" />
                    {s.localMuted[menu.user.fingerprint]
                      ? "Réactiver localement"
                      : "Mute local"}
                  </button>
                </>
              )}
              <hr />
              {(menu.user.id === s.self_id
                ? menuPermissions["channel.move_self"]
                : menuPermissions["channel.move_others"]) && (
                <label className="context-move">
                  <Icon name="move" />
                  Déplacer vers
                  <select
                    aria-label="Salon de destination"
                    value=""
                    onChange={(e) => {
                      const c = s.channels.find((c) => c.id === e.target.value);
                      if (c) move(menu.user!.id, c);
                    }}
                  >
                    <option value="">Choisir un salon…</option>
                    {s.channels
                      .filter(
                        (c) =>
                          s.channel_permissions[c.id]?.[
                            menu.user!.id === s.self_id
                              ? "channel.move_self"
                              : "channel.move_others"
                          ],
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {menu.user.id !== s.self_id &&
                s.permissions["chat.private.send"] && (
                  <button
                    onClick={() => {
                      openPrivate(menu.user!.fingerprint, menu.user!.nickname);
                      setMenu(null);
                    }}
                  >
                    Envoyer un message privé
                  </button>
                )}
              <button
                onClick={() => {
                  setProfile(menu.user!);
                  setMenu(null);
                }}
              >
                <Icon name="info" />
                Informations utilisateur
              </button>
              {menu.user.id === s.self_id && (
                <button
                  onClick={async () => {
                    const value = await promptDialog(
                      "Votre pseudonyme",
                      menu.user!.nickname,
                    );
                    if (value)
                      void changeNickname(value)
                        .then(() => setNickname(value))
                        .catch(report);
                    setMenu(null);
                  }}
                >
                  <Icon name="edit" />
                  Changer mon pseudo
                </button>
              )}
              {s.permissions["role.assign"] && (
                <button
                  onClick={() => {
                    showAdmin(true);
                    setMenu(null);
                  }}
                >
                  <Icon name="shield" />
                  Rôles et permissions
                </button>
              )}
              {menuPermissions["voice.mute_others"] && (
                <button
                  onClick={() =>
                    void request("MUTE_USER", {
                      user_id: menu.user!.id,
                      muted: !menu.user!.server_muted,
                    })
                      .then(() => setMenu(null))
                      .catch(report)
                  }
                >
                  <Icon name="micOff" />
                  {menu.user.server_muted
                    ? "Autoriser le micro"
                    : "Rendre muet pour tous"}
                </button>
              )}
              {s.permissions["user.change_others_nickname"] &&
                menu.user.id !== s.self_id && (
                  <button
                    onClick={async () => {
                      const name = await promptDialog(
                        "Nouveau pseudonyme",
                        menu.user!.nickname,
                      );
                      if (name)
                        void request("CHANGE_NICKNAME", {
                          user_id: menu.user!.id,
                          nickname: name,
                        }).catch(report);
                      setMenu(null);
                    }}
                  >
                    <Icon name="edit" />
                    Modifier le pseudo
                  </button>
                )}
              <hr />
              {menuPermissions["user.kick"] && (
                <button
                  className="danger-text"
                  onClick={() => void moderation(menu.user!)}
                >
                  <Icon name="logout" />
                  Expulser du serveur
                </button>
              )}
              {menuPermissions["user.ban"] && (
                <button
                  className="danger-text"
                  onClick={() => void moderation(menu.user!, true)}
                >
                  <Icon name="ban" />
                  Bannir
                </button>
              )}
            </>
          ) : (
            menu.channel && (
              <>
                <div className="context-profile">
                  <Icon name="channel" />
                  <strong>{menu.channel.name}</strong>
                </div>
                <button
                  disabled={
                    !menuPermissions["channel.join"] ||
                    !menuPermissions["channel.move_self"]
                  }
                  onClick={() => void join(menu.channel!)}
                >
                  <Icon name="connect" />
                  Rejoindre le salon
                </button>
                {menuPermissions["channel.create"] && (
                  <button
                    onClick={() => {
                      setEditor({ parent: menu.channel!.id });
                      setMenu(null);
                    }}
                  >
                    <Icon name="plus" />
                    Créer un sous-salon
                  </button>
                )}
                {menuPermissions["channel.edit"] && (
                  <button
                    onClick={() => {
                      setEditor({ channel: menu.channel! });
                      setMenu(null);
                    }}
                  >
                    <Icon name="edit" />
                    Modifier le salon
                  </button>
                )}
                {menuPermissions["permissions.edit"] && (
                  <button
                    onClick={() => {
                      showAdmin(true);
                      setMenu(null);
                    }}
                  >
                    <Icon name="shield" />
                    Permissions du salon
                  </button>
                )}
                {menuPermissions["channel.delete"] && (
                  <>
                    <hr />
                    <button
                      className="danger-text"
                      onClick={async () => {
                        const id = menu.channel!.id;
                        if (
                          await confirmDialog(
                            "Supprimer ce salon ? Cette action est définitive.",
                          )
                        )
                          void request("DELETE_CHANNEL", { id }).catch(report);
                        setMenu(null);
                      }}
                    >
                      <Icon name="trash" />
                      Supprimer le salon
                    </button>
                  </>
                )}
              </>
            )
          )}
        </ContextMenu>
      )}
      <ActionDialog />
      <Updater />
    </main>
  );
}
