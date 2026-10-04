export function parseYouTubeID(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.port
    )
      return null;
    const path = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    let id = "";
    if (u.hostname === "youtu.be" && path.length === 1) id = path[0];
    if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
      ].includes(u.hostname)
    ) {
      if (u.pathname === "/watch") id = u.searchParams.get("v") ?? "";
      if (path.length === 2 && ["shorts", "embed", "live"].includes(path[0]))
        id = path[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export function canonicalPosition(a, serverNow) {
  if (!a) return 0;
  const elapsed =
    a.state === "PLAYING"
      ? Math.max(0, (serverNow - a.reference_timestamp) / 1000)
      : 0;
  return Math.max(
    0,
    a.duration > 0
      ? Math.min(a.duration, a.position_reference + elapsed)
      : a.position_reference + elapsed,
  );
}
export function clockSample(serverTime, sent, received) {
  const rtt = received - sent;
  return { rtt, offset: serverTime - (sent + received) / 2 };
}
export function driftNeedsSeek(drift) {
  return Math.abs(drift) > 1.25;
}
