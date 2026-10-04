import { create } from "zustand";
import { request } from "./control";
import { useStore } from "./store";
import type { YouTubeActivity } from "./types";
import { canonicalPosition, clockSample } from "./youtube-sync.mjs";
export { parseYouTubeID } from "./youtube-sync.mjs";
export const useYouTube = create<{
  activity: YouTubeActivity | null;
  offset: number;
  rtt: number | null;
  drift: number | null;
  volume: number;
  muted: boolean;
  preferred: "youtube" | "screens";
  error: string;
}>(() => ({
  activity: null,
  offset: 0,
  rtt: null,
  drift: null,
  volume: Number(localStorage.getItem("youtubeVolume") ?? 60),
  muted: localStorage.getItem("youtubeMuted") === "true",
  preferred: "youtube",
  error: "",
}));
let samples: { rtt: number; offset: number; received: number }[] = [];
let channel = "",
  generation = 0;
export function sampleYouTubeClock(
  serverTime: number,
  sent: number,
  received: number,
) {
  if (!Number.isFinite(serverTime)) return;
  const sample = clockSample(serverTime, sent, received);
  samples = [
    ...samples.filter((s) => received - s.received < 120000),
    { ...sample, received },
  ].slice(-8);
  const best = samples.reduce((a, b) => (a.rtt < b.rtt ? a : b));
  useYouTube.setState({ offset: best.offset, rtt: best.rtt });
}
export function youtubePosition(a = useYouTube.getState().activity) {
  return canonicalPosition(
    a,
    performance.timeOrigin + performance.now() + useYouTube.getState().offset,
  );
}
export function youtubeEvent(type: string, p: any) {
  const s = useStore.getState();
  const current = s.users.find((u) => u.id === s.self_id)?.channel_id ?? "";
  if (type === "SNAPSHOT") {
    channel = current;
    generation++;
    samples = [];
    useYouTube.setState({
      activity: p.youtube_activity ?? null,
      error: "",
      drift: null,
      preferred: "youtube",
    });
    return;
  }
  if (type !== "YOUTUBE_STATE" || p.channel_id !== current) return;
  const previous = useYouTube.getState().activity;
  if (
    p.activity &&
    previous &&
    previous.channel_id === p.activity.channel_id &&
    p.activity.revision < previous.revision
  )
    return;
  useYouTube.setState({ activity: p.activity ?? null, error: "" });
}
export async function syncYouTube() {
  const s = useStore.getState();
  const current = s.users.find((u) => u.id === s.self_id)?.channel_id ?? "";
  if (
    s.status !== "connected" ||
    !current ||
    !s.youtube?.enabled ||
    !s.channel_permissions[current]?.["youtube.view"]
  ) {
    channel = current;
    generation++;
    useYouTube.setState({ activity: null, drift: null });
    return;
  }
  if (channel === current) return;
  channel = current;
  const g = ++generation;
  useYouTube.setState({ activity: null, drift: null, preferred: "youtube" });
  try {
    const p = await request("YOUTUBE_GET");
    if (g === generation) youtubeEvent("YOUTUBE_STATE", p);
  } catch (e) {
    if (g === generation) channel = "";
    throw e;
  }
}
export function clearYouTube() {
  channel = "";
  generation++;
  samples = [];
  useYouTube.setState({ activity: null, drift: null, rtt: null, error: "" });
}
export async function youtubeAction(
  type: string,
  payload: Record<string, unknown> = {},
) {
  const s = useStore.getState();
  const ch = s.users.find((u) => u.id === s.self_id)?.channel_id ?? "";
  const a = useYouTube.getState().activity;
  const p = await request(type, {
    ...payload,
    channel_id: ch,
    revision: a?.channel_id === ch ? a.revision : 0,
  });
  youtubeEvent("YOUTUBE_STATE", p);
}
