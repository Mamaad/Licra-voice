import { useEffect, useState } from "react";
import { Modal } from "./Modal";
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
export function Admin({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState("roles"),
    [role, setRole] = useState<Role>({
      id: "",
      name: "",
      protected: false,
      permissions: {},
    }),
    [fp, setFP] = useState(""),
    [scope, setScope] = useState(""),
    [assigned, setAssigned] = useState("Member"),
    [assignments, setAssignments] = useState<any[]>([]),
    [bans, setBans] = useState<any[]>([]),
    [overrides, setOverrides] = useState<any[]>([]),
    [permission, setPermission] = useState("channel.join"),
    [effect, setEffect] = useState<Effect>("DENY"),
    [name, setName] = useState(s.server.name),
    [logs, setLogs] = useState("");
  function refresh() {
    if (s.permissions["role.view"])
      void request("LIST_DEVICE_ROLES").then(setAssignments).catch(report);
    if (s.permissions["user.ban"])
      void request("LIST_BANS").then(setBans).catch(report);
    if (s.permissions["permissions.view"])
      void request("LIST_OVERRIDES").then(setOverrides).catch(report);
  }
  useEffect(refresh, []);
  const scopes = (
    <select value={scope} onChange={(e) => setScope(e.target.value)}>
      <option value="">SERVER</option>
      {s.channels.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} et descendants
        </option>
      ))}
    </select>
  );
  return (
    <Modal title="Administration du serveur" onClose={onClose}>
      <nav>
        {["roles", "attributions", "exceptions", "bans", "serveur"].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      {tab === "roles" && (
        <>
          <label>
            Rôle
            <select
              value={role.id}
              onChange={(e) =>
                setRole(
                  s.roles.find((r) => r.id === e.target.value) ?? {
                    id: "",
                    name: "",
                    protected: false,
                    permissions: {},
                  },
                )
              }
            >
              <option value="">Nouveau rôle</option>
              {s.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nom
            <input
              value={role.name}
              disabled={role.protected}
              onChange={(e) => setRole({ ...role, name: e.target.value })}
            />
          </label>
          <div className="permission-grid">
            {permissions.map((p) => (
              <label key={p}>
                {p}
                <select
                  disabled={
                    role.protected || !s.permissions["permissions.edit"]
                  }
                  value={role.permissions[p] ?? "INHERIT"}
                  onChange={(e) =>
                    setRole({
                      ...role,
                      permissions: {
                        ...role.permissions,
                        [p]: e.target.value as Effect,
                      },
                    })
                  }
                >
                  {["INHERIT", "ALLOW", "DENY"].map((e) => (
                    <option key={e}>{e}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            disabled={
              role.protected ||
              !s.permissions[role.id ? "role.edit" : "role.create"]
            }
            onClick={() =>
              void request("UPSERT_ROLE", role).then(refresh).catch(report)
            }
          >
            Enregistrer
          </button>
          <button
            disabled={
              role.protected || !role.id || !s.permissions["role.delete"]
            }
            onClick={() => {
              if (confirm("Supprimer ce rôle ?"))
                void request("DELETE_ROLE", { id: role.id })
                  .then(() => {
                    setRole({
                      id: "",
                      name: "",
                      protected: false,
                      permissions: {},
                    });
                    refresh();
                  })
                  .catch(report);
            }}
          >
            Supprimer
          </button>
        </>
      )}
      {tab === "attributions" && (
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
          {assignments.map((a) => (
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
      )}
      {tab === "exceptions" && (
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
              !scope || !s.channel_permissions[scope]?.["permissions.edit"]
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
      {tab === "serveur" && (
        <>
          <label>
            Nom
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            disabled={!s.permissions["server.edit"]}
            onClick={() => void request("EDIT_SERVER", { name }).catch(report)}
          >
            Enregistrer
          </button>
          <button
            disabled={!s.permissions["server.view_logs"]}
            onClick={() =>
              void request("GET_SERVER_LOGS")
                .then((p) => setLogs(p.lines.join("\n")))
                .catch(report)
            }
          >
            Lire les logs
          </button>
          <pre>{logs}</pre>
          <button
            disabled={!s.permissions["server.view_logs"]}
            onClick={() =>
              void request("GET_SERVER_DIAGNOSTICS")
                .then((p) => setLogs(JSON.stringify(p, null, 2)))
                .catch(report)
            }
          >
            Diagnostics
          </button>
          <button
            disabled={!s.permissions["server.shutdown"]}
            onClick={() => {
              if (
                confirm(
                  "Arrêter le serveur ? Redémarrez-le ensuite depuis Linux.",
                )
              )
                void request("SHUTDOWN_SERVER").catch(report);
            }}
          >
            Arrêter le serveur
          </button>
        </>
      )}
    </Modal>
  );
}
