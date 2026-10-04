import { useState, type ReactNode } from "react";
import { connect, disconnect, request, report } from "./control";
import { useStore } from "./store";
import { toggleMute, toggleDeafen, setVolume, localVolumes } from "./voice";
import type { Channel, User } from "./types";
import { Settings } from "./Settings";
import { Updater } from "./Updater";
import { Admin, ChannelEditor } from "./Admin";
export function App() {
  const s = useStore();
  const [address, setAddress] = useState(s.history[0] ?? "127.0.0.1:64738"),
    [nickname, setNickname] = useState(localStorage.getItem("nickname") ?? ""),
    [settings, showSettings] = useState(false),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      user?: User;
      channel?: Channel;
    } | null>(null);
  const [admin, showAdmin] = useState(false),
    [editor, setEditor] = useState<{
      channel?: Channel;
      parent?: string;
    } | null>(null);
  const selected = s.channels.find((c) => c.id === s.selected),
    self = s.users.find((u) => u.id === s.self_id);
  const permissions =
    s.channel_permissions[selected?.id ?? ""] ?? s.permissions;
  function join(c: Channel) {
    const password = c.has_password
      ? (prompt("Mot de passe du salon") ?? "")
      : "";
    void request("JOIN_CHANNEL", { channel_id: c.id, password }).catch(report);
  }
  function tree(parent: string | null, depth = 0): ReactNode {
    if (depth > 64) return null;
    return s.channels
      .filter((c) => c.parent_id === parent)
      .sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      )
      .map((c) => (
        <div key={c.id} className="branch">
          <button
            className={"channel " + (c.id === s.selected ? "selected" : "")}
            onClick={() => s.set({ selected: c.id })}
            onDoubleClick={() => join(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, channel: c });
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id === s.self_id) join(c);
              else
                void request("MOVE_USER", {
                  channel_id: c.id,
                  user_id: id,
                }).catch(report);
            }}
          >
            ▾ 🔊 {c.name}
            {c.has_password ? " 🔒" : ""}
          </button>
          {s.users.filter((u) => u.channel_id === c.id).map(user)}
          {tree(c.id, depth + 1)}
        </div>
      ));
  }
  function user(u: User) {
    return (
      <button
        key={u.id}
        className={"user " + (s.talking.includes(u.id) ? "speaking" : "")}
        draggable={
          u.id === s.self_id
            ? !!(s.channel_permissions[u.channel_id]?.["channel.move_self"] ?? s.permissions["channel.move_self"])
            : !!(s.channel_permissions[u.channel_id]?.["channel.move_others"] ?? s.permissions["channel.move_others"])
        }
        onDragStart={(e) => e.dataTransfer.setData("text/plain", u.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, user: u });
        }}
      >
        {u.server_muted || u.muted
          ? "🔇"
          : s.talking.includes(u.id)
            ? "🎙"
            : "●"}{" "}
        {u.nickname}
        {u.id === s.self_id ? " (vous)" : ""}
        {u.deafened ? " 🎧" : ""}
      </button>
    );
  }
  function favorite() {
    const name = prompt("Nom du favori");
    if (!name) return;
    const favorites = [
      ...s.favorites.filter((f) => f.address !== address),
      { name, address, nickname },
    ];
    localStorage.setItem("favorites", JSON.stringify(favorites));
    s.set({ favorites });
  }
  return (
    <main onClick={() => menu && setMenu(null)}>
      <header>
        <strong>LICRA</strong>
        <span>{s.server.name}</span>
        <button disabled={s.status !== "connected"} onClick={disconnect}>
          Déconnecter
        </button>
        <button
          onClick={() => void toggleMute().catch(report)}
          aria-pressed={s.muted}
        >
          {s.muted ? "🔇 Micro coupé" : "🎙 Micro"}
        </button>
        <button
          onClick={() => void toggleDeafen().catch(report)}
          aria-pressed={s.deafened}
        >
          🎧 {s.deafened ? "Son coupé" : "Écouter"}
        </button>
        <button onClick={() => showSettings(true)}>Paramètres</button>
        {s.status === "connected" && s.permissions["role.view"] && (
          <button onClick={() => showAdmin(true)}>Administration</button>
        )}
      </header>
      {s.error && (
        <div role="alert" className="error">
          {s.error}
          <button onClick={() => s.set({ error: "" })}>Fermer</button>
        </div>
      )}
      <div className="layout">
        <aside>
          {s.status === "connected" ? (
            <>
              <h2>{s.server.name}</h2>
              {s.permissions["channel.create"] && (
                <button onClick={() => setEditor({})}>＋ Salon</button>
              )}
              {tree(null)}
              <section>
                <h3>Hors salon</h3>
                {s.users.filter((u) => !u.channel_id).map(user)}
              </section>
              <button
                onClick={() => {
                  const token = prompt("Bootstrap administrator token");
                  if (token)
                    void request("CLAIM_OWNER", { token }).catch(report);
                }}
              >
                Réclamer le rôle Owner
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                localStorage.setItem("nickname", nickname);
                void connect(address, nickname).catch(report);
              }}
            >
              <h2>Se connecter</h2>
              <label>
                Adresse serveur
                <input
                  required
                  list="history"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="1.2.3.4:64738"
                />
              </label>
              <datalist id="history">
                {s.history.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
              <label>
                Pseudonyme
                <input
                  required
                  maxLength={32}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </label>
              <button disabled={s.status === "connecting"}>
                {s.status === "connecting" ? "Connexion…" : "Connecter"}
              </button>
              <button type="button" onClick={favorite}>
                ☆ Favori
              </button>
              <h3>Favoris</h3>
              {s.favorites.map((f) => (
                <div key={f.address}>
                  <button
                    type="button"
                    onClick={() => {
                      setAddress(f.address);
                      setNickname(f.nickname);
                    }}
                  >
                    {f.name}
                  </button>
                  <button
                    type="button"
                    aria-label={"Supprimer " + f.name}
                    onClick={() => {
                      const favorites = s.favorites.filter(
                        (x) => x.address !== f.address,
                      );
                      localStorage.setItem(
                        "favorites",
                        JSON.stringify(favorites),
                      );
                      s.set({ favorites });
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </form>
          )}
        </aside>
        <article>
          {selected ? (
            <>
              <p className="eyebrow">SALON VOCAL</p>
              <h1>{selected.name}</h1>
              <p>
                {selected.description ||
                  "Double-cliquez sur un salon pour rejoindre la conversation."}
              </p>
              <p>
                Opus · 48 kHz · Mono · {selected.audio_profile} ·{" "}
                {s.users.filter((u) => u.channel_id === selected.id).length}{" "}
                participants
              </p>
              <button
                disabled={!permissions["channel.join"]}
                onClick={() => join(selected)}
              >
                Rejoindre
              </button>
              {self?.channel_id && (
                <button
                  onClick={() => void request("LEAVE_CHANNEL").catch(report)}
                >
                  Quitter le vocal
                </button>
              )}
              <div className="cards">
                {s.users
                  .filter((u) => u.channel_id === selected.id)
                  .map((u) => (
                    <section
                      key={u.id}
                      className={s.talking.includes(u.id) ? "speaking" : ""}
                    >
                      <h3>{u.nickname}</h3>
                      <p>
                        {u.server_muted
                          ? "Micro interdit"
                          : u.muted
                            ? "Micro coupé"
                            : s.talking.includes(u.id)
                              ? "Parle"
                              : "En écoute"}
                      </p>
                      {u.id !== s.self_id && (
                        <>
                          <label>
                            Volume local {s.volumes[u.fingerprint] ?? 100}%
                            <input
                              type="range"
                              min="0"
                              max="200"
                              value={s.volumes[u.fingerprint] ?? 100}
                              onChange={(e) =>
                                setVolume(u.fingerprint, Number(e.target.value))
                              }
                            />
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={!!s.localMuted[u.fingerprint]}
                              onChange={(e) => {
                                s.set({
                                  localMuted: {
                                    ...s.localMuted,
                                    [u.fingerprint]: e.target.checked,
                                  },
                                });
                                localVolumes();
                              }}
                            />
                            Couper localement
                          </label>
                        </>
                      )}
                    </section>
                  ))}
              </div>
            </>
          ) : (
            <>
              <p className="eyebrow">VOIX · SANS COMPTE · AUTO-HÉBERGÉ</p>
              <h1>
                Votre serveur.
                <br />
                Votre conversation.
              </h1>
              <p>
                Une adresse, un pseudo et une identité qui reste sur votre
                appareil.
              </p>
            </>
          )}
        </article>
      </div>
      <footer>
        <span className={"dot " + s.status} />
        {s.status === "connected"
          ? "Connecté"
          : s.status === "connecting"
            ? "Connexion en cours"
            : "Déconnecté"}{" "}
        · {s.address}
        <span>
          {self?.channel_id
            ? s.channels.find((c) => c.id === self.channel_id)?.name
            : "Hors salon"}
        </span>
      </footer>
      {admin && <Admin onClose={() => showAdmin(false)} />}{" "}
      {editor && <ChannelEditor {...editor} onClose={() => setEditor(null)} />}{" "}
      {settings && <Settings onClose={() => showSettings(false)} />}{" "}
      {menu && (
        <div
          className="context"
          style={{
            left: Math.min(menu.x, innerWidth - 240),
            top: Math.min(menu.y, innerHeight - 220),
          }}
        >
          {menu.channel && (
            <>
              <button
                disabled={
                  !s.channel_permissions[menu.channel.id]?.["channel.join"]
                }
                onClick={() => join(menu.channel!)}
              >
                Rejoindre {menu.channel.name}
              </button>
              {s.channel_permissions[menu.channel.id]?.["channel.create"] && (
                <button onClick={() => setEditor({ parent: menu.channel!.id })}>
                  Créer un sous-salon
                </button>
              )}
              {s.channel_permissions[menu.channel.id]?.["channel.edit"] && (
                <button onClick={() => setEditor({ channel: menu.channel })}>
                  Modifier
                </button>
              )}
              {s.channel_permissions[menu.channel.id]?.["channel.delete"] && (
                <button
                  onClick={() => {
                    if (confirm("Supprimer ce salon ?"))
                      void request("DELETE_CHANNEL", {
                        id: menu.channel!.id,
                      }).catch(report);
                  }}
                >
                  Supprimer
                </button>
              )}
            </>
          )}
          {menu.user && (
            <>
              <strong>{menu.user.nickname}</strong>
              {s.channel_permissions[menu.user.channel_id]?.["user.kick"] ||
              s.permissions["user.kick"] ? (
                <button
                  onClick={() =>
                    void request("KICK_USER", {
                      user_id: menu.user!.id,
                      reason: prompt("Motif") ?? "",
                    }).catch(report)
                  }
                >
                  Expulser
                </button>
              ) : null}
              {s.channel_permissions[menu.user.channel_id]?.["user.ban"] ||
              s.permissions["user.ban"] ? (
                <button
                  onClick={() => {
                    const reason = prompt("Motif du ban");
                    if (reason === null) return;
                    const minutes = prompt(
                      "Durée en minutes (vide = permanent)",
                    );
                    if (minutes === null) return;
                    const n = Number(minutes);
                    if (minutes && (n <= 0 || !Number.isFinite(n))) {
                      report(new Error("Durée invalide"));
                      return;
                    }
                    void request("BAN_USER", {
                      user_id: menu.user!.id,
                      reason,
                      expires_at: minutes
                        ? new Date(Date.now() + n * 60000).toISOString()
                        : null,
                    }).catch(report);
                  }}
                >
                  Bannir
                </button>
              ) : null}
              {s.channel_permissions[menu.user.channel_id]?.[
                "voice.mute_others"
              ] || s.permissions["voice.mute_others"] ? (
                <button
                  onClick={() =>
                    void request("MUTE_USER", {
                      user_id: menu.user!.id,
                      muted: !menu.user!.server_muted,
                    }).catch(report)
                  }
                >
                  {menu.user.server_muted
                    ? "Autoriser le micro"
                    : "Interdire le micro"}
                </button>
              ) : null}
              {s.permissions["user.change_others_nickname"] && (
                <button
                  onClick={() => {
                    const nickname = prompt(
                      "Nouveau pseudo",
                      menu.user!.nickname,
                    );
                    if (nickname)
                      void request("CHANGE_NICKNAME", {
                        user_id: menu.user!.id,
                        nickname,
                      }).catch(report);
                  }}
                >
                  Changer le pseudo
                </button>
              )}
              <p className="fingerprint" title={menu.user.fingerprint}>
                {menu.user.fingerprint}
              </p>
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(menu.user!.fingerprint)
                    .catch(report)
                }
              >
                Copier l’identité
              </button>
            </>
          )}
        </div>
      )}
      <Updater />
    </main>
  );
}
