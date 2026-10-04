import { useEffect, useState } from "react";
import { Modal, confirmDialog } from "./Modal";
import { useStore } from "./store";
import { request, report } from "./control";
import type { Channel, Effect, Role } from "./types";
import { permissionNames as permissions } from "./permissions";
export function ChannelEditor({
  channel,
  parent,
  onClose,
}: {
  channel?: Channel;
  parent?: string;
  onClose: () => void;
}) {
  const s = useStore();
  const [v, set] = useState({
    id: channel?.id ?? "",
    name: channel?.name ?? "",
    description: channel?.description ?? "",
    parent_id: channel?.parent_id ?? parent ?? "",
    max_users: channel?.max_users ?? 0,
    sort_order: channel?.sort_order ?? 0,
    audio_profile: channel?.audio_profile ?? "standard",
    is_permanent: channel?.is_permanent ?? true,
  });
  const [password, setPassword] = useState<string | undefined>();
  return (
    <Modal
      title={channel ? "Modifier le salon" : "Créer un salon"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void request(channel ? "UPDATE_CHANNEL" : "CREATE_CHANNEL", {
            ...v,
            parent_id: v.parent_id || null,
            ...(password !== undefined ? { password } : {}),
          })
            .then(onClose)
            .catch(report);
        }}
      >
        <label>
          Nom
          <input
            required
            maxLength={64}
            value={v.name}
            onChange={(e) => set({ ...v, name: e.target.value })}
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={2048}
            value={v.description}
            onChange={(e) => set({ ...v, description: e.target.value })}
          />
        </label>
        <label>
          Parent
          <select
            value={v.parent_id}
            onChange={(e) => set({ ...v, parent_id: e.target.value })}
          >
            <option value="">Racine</option>
            {s.channels
              .filter((c) => c.id !== v.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Profil Opus
          <select
            value={v.audio_profile}
            onChange={(e) =>
              set({
                ...v,
                audio_profile: e.target.value as typeof v.audio_profile,
              })
            }
          >
            <option value="eco">Eco · 24 kbps</option>
            <option value="standard">Standard · 32 kbps</option>
            <option value="high">High · 64 kbps</option>
          </select>
        </label>
        <label>
          Capacité (0 = illimitée)
          <input
            type="number"
            min="0"
            max="10000"
            value={v.max_users}
            onChange={(e) => set({ ...v, max_users: Number(e.target.value) })}
          />
        </label>
        <label>
          Ordre
          <input
            type="number"
            value={v.sort_order}
            onChange={(e) => set({ ...v, sort_order: Number(e.target.value) })}
          />
        </label>
        <label>
          Nouveau mot de passe (vide = supprimer)
          <input
            type="password"
            maxLength={72}
            autoComplete="new-password"
            value={password ?? ""}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={v.is_permanent}
            onChange={(e) => set({ ...v, is_permanent: e.target.checked })}
          />
          Permanent
        </label>
        <button>Enregistrer</button>
      </form>
    </Modal>
  );
}
import { Icon, Avatar, StatusDot } from "./ui";
import { voiceDiagnostics } from "./voice";

const labels: Record<string, string> = {
  "youtube.view": "Regarder YouTube",
  "youtube.start": "Démarrer une activité YouTube",
  "youtube.control": "Lire et mettre en pause pour le salon",
  "youtube.seek": "Changer la position de lecture",
  "youtube.change_video": "Changer de vidéo",
  "youtube.stop": "Arrêter l’activité YouTube",
  "youtube.queue_manage": "Gérer la file YouTube",

  "chat.channel.view": "Voir le chat du salon",
  "chat.channel.send": "Envoyer dans le chat",
  "chat.channel.history": "Consulter l’historique",
  "chat.channel.edit_own": "Modifier ses messages",
  "chat.channel.delete_own": "Supprimer ses messages",
  "chat.channel.delete_others": "Supprimer les messages des autres",
  "chat.private.send": "Envoyer des messages privés",
  "chat.moderation.view_deleted": "Voir les messages supprimés",
  "screen.share": "Partager son écran",
  "screen.watch": "Regarder les partages",
  "screen.stop_others": "Arrêter le partage des autres",

  "server.view": "Voir le serveur",
  "server.edit": "Modifier le serveur",
  "server.shutdown": "Arrêter le serveur",
  "server.view_logs": "Voir les logs et diagnostics",
  "channel.create": "Créer des salons",
  "channel.edit": "Modifier les salons",
  "channel.delete": "Supprimer des salons",
  "channel.join": "Rejoindre un salon",
  "channel.join_full": "Rejoindre un salon complet",
  "channel.join_password_bypass": "Ignorer le mot de passe",
  "channel.move_self": "Changer de salon",
  "channel.move_others": "Déplacer des utilisateurs",
  "voice.speak": "Parler",
  "voice.mute_others": "Rendre muets les utilisateurs",
  "voice.priority_speaker": "Utiliser la priorité vocale",
  "user.kick": "Expulser des utilisateurs",
  "user.ban": "Bannir des utilisateurs",
  "user.change_others_nickname": "Modifier les pseudonymes",
  "role.view": "Voir les rôles",
  "role.create": "Créer des rôles",
  "role.edit": "Modifier des rôles",
  "role.delete": "Supprimer des rôles",
  "role.assign": "Attribuer des rôles",
  "permissions.view": "Voir les permissions",
  "permissions.edit": "Modifier les permissions",
};
const groups = [
  {
    name: "YOUTUBE — Lecture synchronisée",
    icon: "activity",
    prefixes: ["youtube."],
  },
  { name: "CHAT — Messages et modération", icon: "users", prefixes: ["chat."] },
  { name: "ÉCRAN — Partage d’écran", icon: "activity", prefixes: ["screen."] },
  { name: "VOICE — Permissions vocales", icon: "mic", prefixes: ["voice."] },
  {
    name: "CHANNEL — Permissions des salons",
    icon: "channel",
    prefixes: ["channel."],
  },
  {
    name: "MODÉRATION — Gestion des utilisateurs",
    icon: "shield",
    prefixes: ["user."],
  },
  { name: "SERVEUR — Administration", icon: "server", prefixes: ["server."] },
  {
    name: "RÔLES — Rôles et permissions",
    icon: "users",
    prefixes: ["role.", "permissions."],
  },
];
const builtInRoles = ["Owner", "Administrator", "Moderator", "Member", "Guest"];
const emptyRole: Role = { id: "", name: "", protected: false, permissions: {} };
export function Admin({ onClose }: { onClose: () => void }) {
  const s = useStore(),
    [tab, setTab] = useState("overview"),
    [role, setRole] = useState<Role>(
      s.roles.find((r) => r.id === "Moderator") ?? s.roles[0] ?? emptyRole,
    ),
    [roleTab, setRoleTab] = useState("permissions"),
    [search, setSearch] = useState("");
  const [fp, setFP] = useState(""),
    [scope, setScope] = useState(""),
    [assigned, setAssigned] = useState(
      s.roles.find((r) => r.id === "Member")?.id ?? s.roles[0]?.id ?? "",
    ),
    [assignments, setAssignments] = useState<any[]>([]),
    [bans, setBans] = useState<any[]>([]),
    [overrides, setOverrides] = useState<any[]>([]),
    [permission, setPermission] = useState("channel.join"),
    [effect, setEffect] = useState<Effect>("DENY"),
    [name, setName] = useState(s.server.name),
    [logs, setLogs] = useState(""),
    [diagnostics, setDiagnostics] = useState<Record<string, any> | null>(null),
    [voice, setVoice] = useState<Record<string, any> | null>(null),
    [channel, setChannel] = useState<{ channel?: Channel } | null>(null);
  function refresh() {
    if (s.permissions["role.view"])
      void request("LIST_DEVICE_ROLES").then(setAssignments).catch(report);
    if (s.permissions["user.ban"])
      void request("LIST_BANS").then(setBans).catch(report);
    if (s.permissions["permissions.view"])
      void request("LIST_OVERRIDES").then(setOverrides).catch(report);
  }
  useEffect(refresh, []);
  const visibleAssignments = assignments.filter(
    (a) => tab !== "roles" || a.role_id === role.id,
  );
  const scopes = (
    <select value={scope} onChange={(e) => setScope(e.target.value)}>
      <option value="">Serveur entier</option>
      {s.channels.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} et descendants
        </option>
      ))}
    </select>
  );
  async function saveRole() {
    try {
      const p = await request("UPSERT_ROLE", role);
      setRole(
        p?.id
          ? p
          : (useStore
              .getState()
              .roles.find((r) =>
                role.id ? r.id === role.id : r.name === role.name,
              ) ?? role),
      );
      refresh();
    } catch (e) {
      report(e);
    }
  }
  async function removeRole() {
    if (await confirmDialog(`Supprimer le rôle ${role.name} ?`))
      void request("DELETE_ROLE", { id: role.id })
        .then(() => {
          setRole(emptyRole);
          refresh();
        })
        .catch(report);
  }
  const navigation = [
    ["overview", "Vue d’ensemble", "home"],
    ["channels", "Salons", "channel"],
    ["users", "Utilisateurs", "users"],
    ["roles", "Rôles", "shield"],
    ["audio", "Audio", "activity"],
    ["logs", "Logs", "logs"],
    ["diagnostics", "Diagnostic", "activity"],
    ["bans", "Bannissements", "ban"],
  ];
  const assignmentEditor = (
    <>
      <label>
        Identité
        <input
          list="identities"
          value={fp}
          onChange={(e) => setFP(e.target.value)}
        />
      </label>
      <datalist id="identities">
        {s.users.map((u) => (
          <option key={u.id} value={u.fingerprint}>
            {u.nickname}
          </option>
        ))}
      </datalist>
      <label>
        Rôle
        <select value={assigned} onChange={(e) => setAssigned(e.target.value)}>
          {s.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>Scope{scopes}</label>
      <button
        disabled={!s.permissions["role.assign"]}
        onClick={() =>
          void request("ASSIGN_ROLE", {
            fingerprint: fp,
            role_id: assigned,
            channel_id: scope,
          })
            .then(refresh)
            .catch(report)
        }
      >
        Attribuer
      </button>
      {visibleAssignments.map((a) => (
        <section key={a.fingerprint + a.role_id + a.channel_id}>
          <p className="fingerprint">{a.fingerprint}</p>
          {a.role_id} ·{" "}
          {s.channels.find((c) => c.id === a.channel_id)?.name ?? "SERVER"}
          <button
            disabled={!s.permissions["role.assign"]}
            onClick={() =>
              void request("ASSIGN_ROLE", { ...a, remove: true })
                .then(refresh)
                .catch(report)
            }
          >
            Retirer
          </button>
        </section>
      ))}
    </>
  );
  return (
    <Modal
      title={`Paramètres du serveur · ${s.server.name}`}
      className="admin-modal"
      onClose={onClose}
    >
      <nav className="admin-nav">
        {navigation
          .filter(
            ([id]) =>
              !["logs", "diagnostics"].includes(id) ||
              s.permissions["server.view_logs"],
          )
          .filter(([id]) => id !== "bans" || s.permissions["user.ban"])
          .map(([id, label, icon]) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              onClick={() => setTab(id)}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
      </nav>
      <section className="admin-body">
        {tab === "overview" && (
          <>
            <h2>Vue d’ensemble</h2>
            <section className="settings-section">
              <h3>Informations du serveur</h3>
              <div className="info-grid">
                <div>
                  Utilisateurs en ligne
                  <strong>
                    <StatusDot status={s.status} /> {s.users.length}
                  </strong>
                </div>
                <div>
                  Version du serveur
                  <strong>{s.serverVersion || "Non communiquée"}</strong>
                </div>
                <div>
                  Adresse<strong>{s.address}</strong>
                </div>
                <div>
                  Identité du serveur
                  <strong className="fingerprint">{s.server.id}</strong>
                </div>
              </div>
              <label>
                Nom du serveur
                <input
                  maxLength={64}
                  value={name}
                  disabled={!s.permissions["server.edit"]}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={!s.permissions["server.edit"] || !name.trim()}
                onClick={() =>
                  void request("EDIT_SERVER", { name }).catch(report)
                }
              >
                <Icon name="check" />
                Enregistrer
              </button>
            </section>
            <section className="settings-section">
              <h3>Configuration audio</h3>
              <p>
                Codec Opus · 48 kHz · mono. La qualité vocale se règle
                séparément dans chaque salon.
              </p>
              <button onClick={() => setTab("audio")}>
                <Icon name="activity" />
                Voir les profils audio
              </button>
            </section>
            {s.permissions["server.shutdown"] && (
              <button
                className="danger-text"
                onClick={async () => {
                  if (
                    await confirmDialog(
                      "Arrêter le serveur ? Il faudra le redémarrer depuis Linux.",
                    )
                  )
                    void request("SHUTDOWN_SERVER").catch(report);
                }}
              >
                <Icon name="logout" />
                Arrêter le serveur
              </button>
            )}
          </>
        )}
        {(tab === "channels" || tab === "audio") && (
          <>
            <h2>
              {tab === "audio" ? "Configuration audio" : "Salons du serveur"}
            </h2>
            {tab === "audio" && (
              <p>
                Opus, 48 kHz mono. Économique : 24 kbps · Standard : 32 kbps ·
                Haute qualité : 64 kbps.
              </p>
            )}
            {s.channels.map((c) => (
              <div className="admin-row" key={c.id}>
                <Icon name="channel" />
                <span>
                  <strong>{c.name}</strong>
                  <small style={{ display: "block", marginTop: 4 }}>
                    {c.audio_profile} ·{" "}
                    {s.users.filter((u) => u.channel_id === c.id).length}
                    {c.max_users ? ` / ${c.max_users}` : " membres"}
                  </small>
                </span>
                {s.channel_permissions[c.id]?.["channel.edit"] && (
                  <button onClick={() => setChannel({ channel: c })}>
                    <Icon name="edit" />
                    Modifier
                  </button>
                )}
              </div>
            ))}
            {s.permissions["channel.create"] && (
              <button
                style={{ marginTop: 18 }}
                className="primary"
                onClick={() => setChannel({})}
              >
                <Icon name="plus" />
                Créer un salon
              </button>
            )}
          </>
        )}
        {tab === "users" && (
          <>
            <h2>Utilisateurs et attributions</h2>
            {s.users.map((u) => (
              <div className="admin-row" key={u.id}>
                <Avatar name={u.nickname} identity={u.fingerprint} />
                <span>
                  {u.nickname}
                  <small className="fingerprint">{u.fingerprint}</small>
                </span>
                <button onClick={() => setFP(u.fingerprint)}>
                  Sélectionner
                </button>
              </div>
            ))}
          </>
        )}
        {tab === "roles" && (
          <div className="roles-layout">
            <aside className="role-list">
              <h3>Rôles du serveur</h3>
              {[...s.roles]
                .sort(
                  (a, b) =>
                    (builtInRoles.indexOf(a.id) < 0
                      ? 99
                      : builtInRoles.indexOf(a.id)) -
                      (builtInRoles.indexOf(b.id) < 0
                        ? 99
                        : builtInRoles.indexOf(b.id)) ||
                    a.name.localeCompare(b.name),
                )
                .filter((r) =>
                  [
                    "Owner",
                    "Administrator",
                    "Moderator",
                    "Member",
                    "Guest",
                  ].includes(r.id),
                )
                .map((r) => (
                  <button
                    key={r.id}
                    className={r.id === role.id ? "selected" : ""}
                    onClick={() => setRole(r)}
                  >
                    <Icon name={r.id === "Owner" ? "crown" : "shield"} />
                    {r.name}
                  </button>
                ))}
              <h3>Rôles personnalisés</h3>
              {[...s.roles]
                .sort(
                  (a, b) =>
                    (builtInRoles.indexOf(a.id) < 0
                      ? 99
                      : builtInRoles.indexOf(a.id)) -
                      (builtInRoles.indexOf(b.id) < 0
                        ? 99
                        : builtInRoles.indexOf(b.id)) ||
                    a.name.localeCompare(b.name),
                )
                .filter(
                  (r) =>
                    ![
                      "Owner",
                      "Administrator",
                      "Moderator",
                      "Member",
                      "Guest",
                    ].includes(r.id),
                )
                .map((r) => (
                  <button
                    key={r.id}
                    className={r.id === role.id ? "selected" : ""}
                    onClick={() => setRole(r)}
                  >
                    <Icon name="user" />
                    {r.name}
                  </button>
                ))}
              {s.permissions["role.create"] &&
                s.permissions["permissions.edit"] && (
                  <button
                    onClick={() => {
                      setRole(emptyRole);
                      setRoleTab("settings");
                    }}
                  >
                    <Icon name="plus" />
                    Nouveau rôle
                  </button>
                )}
            </aside>
            <div className="role-detail">
              <div className="role-detail-heading">
                <div>
                  <h2>{role.name || "Nouveau rôle"}</h2>
                  <small>
                    {role.protected
                      ? "Rôle intégré protégé"
                      : builtInRoles.includes(role.id)
                        ? "Rôle intégré"
                        : "Rôle personnalisé"}
                  </small>
                </div>
                <button
                  className="primary"
                  disabled={
                    role.protected ||
                    !role.name.trim() ||
                    !s.permissions[role.id ? "role.edit" : "role.create"] ||
                    !s.permissions["permissions.edit"]
                  }
                  onClick={() => void saveRole()}
                >
                  <Icon name="check" />
                  Enregistrer
                </button>
              </div>
              <nav className="tabs">
                {[
                  ["permissions", "Permissions", "shield"],
                  ["members", "Membres", "users"],
                  ["inheritance", "Héritage", "channel"],
                  ["settings", "Paramètres", "settings"],
                ].map(([id, label, icon]) => (
                  <button
                    key={id}
                    className={roleTab === id ? "selected" : ""}
                    onClick={() => {
                      setRoleTab(id);
                      if (id !== "permissions") setAssigned(role.id);
                    }}
                  >
                    <Icon name={icon} />
                    {label}
                  </button>
                ))}
              </nav>
              {roleTab === "permissions" && (
                <>
                  <label className="permission-search">
                    <input
                      aria-label="Rechercher une permission"
                      placeholder="Rechercher une permission…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {groups.map((g) => {
                    const list = permissions.filter(
                      (p) =>
                        g.prefixes.some((prefix) => p.startsWith(prefix)) &&
                        `${p} ${labels[p]}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    );
                    return list.length ? (
                      <section className="permission-group" key={g.name}>
                        <h3>
                          <Icon name={g.icon} />
                          {g.name}
                        </h3>
                        {list.map((p) => (
                          <div className="permission-row" key={p}>
                            <span className="permission-label">
                              {labels[p] ?? p}
                              <small>{p}</small>
                            </span>
                            <div
                              className="permission-selector"
                              aria-label={labels[p] ?? p}
                            >
                              {(
                                [
                                  ["ALLOW", "Autoriser", "allow"],
                                  ["INHERIT", "Hériter", "inherit"],
                                  ["DENY", "Refuser", "deny"],
                                ] as const
                              ).map(([value, label, style]) => (
                                <button
                                  type="button"
                                  key={value}
                                  className={`permission-option ${style}`}
                                  aria-pressed={
                                    (role.permissions[p] ?? "INHERIT") === value
                                  }
                                  disabled={
                                    role.protected ||
                                    !s.permissions["permissions.edit"]
                                  }
                                  onClick={() =>
                                    setRole({
                                      ...role,
                                      permissions: {
                                        ...role.permissions,
                                        [p]: value,
                                      },
                                    })
                                  }
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </section>
                    ) : null;
                  })}
                  {role.protected && (
                    <p className="inheritance-note">
                      Les rôles intégrés sont protégés. Créez un rôle
                      personnalisé pour définir ses permissions.
                    </p>
                  )}
                </>
              )}
              {roleTab === "settings" && (
                <>
                  <label>
                    Nom du rôle
                    <input
                      maxLength={64}
                      value={role.name}
                      disabled={role.protected}
                      onChange={(e) =>
                        setRole({ ...role, name: e.target.value })
                      }
                    />
                  </label>
                  <button
                    className="danger-text"
                    disabled={
                      role.protected ||
                      !role.id ||
                      role.id === "Guest" ||
                      !s.permissions["role.delete"]
                    }
                    onClick={() => void removeRole()}
                  >
                    <Icon name="trash" />
                    Supprimer ce rôle
                  </button>
                </>
              )}
              {roleTab === "inheritance" && (
                <p className="inheritance-note">
                  Les rôles s’appliquent au serveur ou à un salon et ses
                  descendants. « Hériter » conserve la décision du niveau
                  supérieur ; les exceptions de salon ci-dessous précisent cette
                  décision.
                </p>
              )}
              {roleTab === "members" && assignmentEditor}
              {roleTab === "inheritance" && (
                <>
                  <label>Salon{scopes}</label>
                  <label>
                    Rôle
                    <select
                      value={assigned}
                      onChange={(e) => setAssigned(e.target.value)}
                    >
                      {s.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Permission
                    <select
                      value={permission}
                      onChange={(e) => setPermission(e.target.value)}
                    >
                      {permissions.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Décision
                    <select
                      value={effect}
                      onChange={(e) => setEffect(e.target.value as Effect)}
                    >
                      {["ALLOW", "DENY", "INHERIT"].map((e) => (
                        <option key={e}>{e}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={
                      !scope ||
                      !s.channel_permissions[scope]?.["permissions.edit"]
                    }
                    onClick={() =>
                      void request("SET_OVERRIDE", {
                        channel_id: scope,
                        role_id: assigned,
                        permission,
                        effect,
                      })
                        .then(refresh)
                        .catch(report)
                    }
                  >
                    Appliquer
                  </button>
                  {overrides.map((o) => (
                    <p key={o.channel_id + o.role_id + o.permission}>
                      {s.channels.find((c) => c.id === o.channel_id)?.name} ·{" "}
                      {o.role_id} · {o.permission} = {o.effect}
                    </p>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
        {tab === "users" && assignmentEditor}
        {tab === "bans" &&
          bans.map((b) => (
            <section key={b.id}>
              <p className="fingerprint">{b.fingerprint ?? b.ip_cidr}</p>
              <p>
                {b.reason} · {b.expires_at ?? "Permanent"}
              </p>
              <button
                disabled={!s.permissions["user.ban"]}
                onClick={() =>
                  void request("DELETE_BAN", { id: b.id })
                    .then(refresh)
                    .catch(report)
                }
              >
                Lever le ban
              </button>
            </section>
          ))}

        {(tab === "logs" || tab === "diagnostics") && (
          <>
            <h2>
              {tab === "logs"
                ? "Journal du serveur"
                : "Diagnostic de connexion"}
            </h2>
            <p>
              Ces informations sont réservées à l’administration. Les mesures
              média sont disponibles pendant une conversation avec réception
              audio.
            </p>
            <button
              style={{ marginTop: 18 }}
              onClick={() => {
                if (tab === "logs")
                  void request("GET_SERVER_LOGS")
                    .then((p) => setLogs(p.lines.join("\n")))
                    .catch(report);
                else {
                  void request("GET_SERVER_DIAGNOSTICS")
                    .then(setDiagnostics)
                    .catch(report);
                  void voiceDiagnostics().then(setVoice).catch(report);
                }
              }}
            >
              <Icon name="refresh" />
              Actualiser
            </button>
            {tab === "logs" ? (
              <pre>
                {logs || "Cliquez sur Actualiser pour lire le journal."}
              </pre>
            ) : (
              <>
                <section className="settings-section" style={{ marginTop: 18 }}>
                  <h3>Serveur</h3>
                  <div className="info-grid">
                    <div>
                      Temps d’activité
                      <strong>
                        {diagnostics
                          ? `${Math.floor(diagnostics.uptime / 3600)} h ${Math.floor(diagnostics.uptime / 60) % 60} min`
                          : "Non mesuré"}
                      </strong>
                    </div>
                    <div>
                      RTT contrôle
                      <strong>
                        {s.connectionRTT !== null
                          ? `${s.connectionRTT} ms`
                          : "Non mesuré"}
                      </strong>
                    </div>
                  </div>
                </section>
                <section className="settings-section">
                  <h3>Transport média</h3>
                  <div className="info-grid">
                    {[
                      ["Transport", voice?.transport?.toUpperCase()],
                      ["Codec", voice?.codec],
                      [
                        "RTT réseau",
                        voice?.rtt_ms != null ? `${voice.rtt_ms} ms` : null,
                      ],
                      [
                        "Jitter",
                        voice?.jitter_ms != null
                          ? `${voice.jitter_ms} ms`
                          : null,
                      ],
                      [
                        "Perte de paquets",
                        voice?.packet_loss_percent != null
                          ? `${voice.packet_loss_percent} %`
                          : null,
                      ],
                      ["Échantillonnage", "48 kHz"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        {label}
                        <strong>{value ?? "Non mesuré"}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </section>
      {channel && (
        <ChannelEditor {...channel} onClose={() => setChannel(null)} />
      )}
    </Modal>
  );
}
