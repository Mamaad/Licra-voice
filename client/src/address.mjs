export function parseAddress(value) {
  const raw = value.trim();
  if (!raw) throw new Error("Adresse serveur requise");
  const explicit = /^https?:\/\//.test(raw);
  const u = new URL(explicit ? raw : "http://" + raw);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new Error("Adresse invalide");
  const supplied = /:([0-9]+)$/.exec(raw)?.[1];
  const port = supplied
    ? Number(supplied)
    : u.port
      ? Number(u.port)
      : explicit
        ? u.protocol === "https:"
          ? 443
          : 80
        : 64738;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Port invalide");
  if (!explicit && port < 1024)
    throw new Error("Utiliser un port de 1024 à 65535");
  if (!explicit) u.port = String(port);
  return { http: u.origin, ws: u.origin.replace(/^http/, "ws") };
}
