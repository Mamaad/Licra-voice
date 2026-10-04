import { create } from "zustand";
import {
  Room,
  RoomEvent,
  Track,
  LocalVideoTrack,
  VideoPreset,
  type VideoTrack,
  type VideoCodec,
} from "livekit-client";
import { useStore } from "./store";
import { request } from "./control";
export type ScreenOptions = {
  quality: "auto" | "1080p" | "1440p" | "source";
  fps: 30 | 60;
  content: "auto" | "text" | "motion";
};
export type ScreenItem = {
  key: string;
  userId: string;
  nickname: string;
  track: VideoTrack;
  local: boolean;
};
export type ScreenShare = {
  user_id: string;
  channel_id: string;
  nickname: string;
  quality: string;
  fps: number;
};
export const useScreens = create<{
  shares: ScreenShare[];
  tracks: ScreenItem[];
  sharing: boolean;
  busy: boolean;
  error: string;
}>(() => ({ shares: [], tracks: [], sharing: false, busy: false, error: "" }));
let room: Room | undefined,
  roomChannel = "",
  epoch = 0,
  joining: Promise<void> | undefined,
  captured: MediaStream | undefined,
  retry: ReturnType<typeof setTimeout> | undefined;
function fail(e: unknown) {
  useScreens.setState({ error: e instanceof Error ? e.message : String(e) });
}
function add(
  track: VideoTrack,
  key: string,
  userId: string,
  nickname: string,
  local: boolean,
) {
  useScreens.setState((s) => ({
    tracks: [
      ...s.tracks.filter((t) => t.key !== key),
      { track, key, userId, nickname, local },
    ],
  }));
}
function remove(key: string) {
  useScreens.setState((s) => ({
    tracks: s.tracks.filter((t) => t.key !== key),
  }));
}
export function screenEvent(type: string, p: any) {
  if (type === "SCREEN_STATE") useScreens.setState({ shares: p.shares });
  if (type === "SCREEN_REVOKED")
    void (p?.publishing_only ? stopScreen(false) : closeScreens());
  if (type === "SNAPSHOT")
    useScreens.setState({ shares: [], tracks: [], sharing: false, error: "" });
}
export async function closeScreens() {
  ++epoch;
  clearTimeout(retry);
  captured?.getTracks().forEach((t) => t.stop());
  captured = undefined;
  const old = room;
  room = undefined;
  roomChannel = "";
  useScreens.setState({ tracks: [], sharing: false });
  await old?.disconnect();
}
async function connectRoom(p: any, url: string) {
  const g = epoch;
  const next = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      resolution: { width: 1920, height: 1080, frameRate: 30 },
    },
    publishDefaults: { simulcast: true, backupCodec: false },
  });
  room = next;
  roomChannel = p.channel_id;
  next.on(RoomEvent.TrackSubscribed, (track, pub, user) => {
    if (room !== next) return;
    if (
      track.kind === Track.Kind.Video &&
      pub.source === Track.Source.ScreenShare
    )
      add(
        track as VideoTrack,
        pub.trackSid,
        user.identity,
        user.name ?? user.identity,
        false,
      );
  });
  next.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
    if (room !== next) return;
    track.detach().forEach((el) => el.remove());
    remove(pub.trackSid);
  });
  next.on(RoomEvent.LocalTrackUnpublished, (pub) => {
    if (room !== next) return;
    remove(pub.trackSid);
    if (useScreens.getState().sharing) void stopScreen().catch(fail);
  });
  next.on(RoomEvent.Disconnected, () => {
    if (room !== next) return;
    room = undefined;
    roomChannel = "";
    captured?.getTracks().forEach((t) => t.stop());
    captured = undefined;
    useScreens.setState({ tracks: [], sharing: false });
    if (useStore.getState().status === "connected")
      void request("SCREEN_STOP")
        .catch(() => {})
        .finally(() => {
          retry = setTimeout(() => void syncScreens(url).catch(fail), 1500);
        });
  });
  try {
    await next.connect(url + p.signaling_path, p.token, {
      autoSubscribe: p.can_watch,
    });
    if (g !== epoch) {
      await next.disconnect();
      return;
    }
  } catch (e) {
    if (room === next) {
      room = undefined;
      roomChannel = "";
    }
    await next.disconnect();
    throw e;
  }
}
export async function syncScreens(url: string) {
  const s = useStore.getState(),
    self = s.users.find((u) => u.id === s.self_id),
    ch = self?.channel_id ?? "",
    p = s.channel_permissions[ch] ?? {};
  if (s.status !== "connected" || !s.screen?.enabled || !ch) {
    await closeScreens();
    return;
  }
  if (room && roomChannel !== ch) await closeScreens();
  const state = useScreens.getState();
  if (state.busy && !room) return;
  if (
    !state.sharing &&
    !state.shares.some((share) => share.channel_id === ch)
  ) {
    if (room) await closeScreens();
    return;
  }

  if (useScreens.getState().sharing && !p["screen.share"]) await stopScreen();
  if (!p["screen.watch"]) {
    if (!useScreens.getState().sharing) await closeScreens();
    return;
  }
  if (room || joining) return joining;
  const g = epoch;
  joining = (async () => {
    const token = await request("SCREEN_JOIN");
    if (g === epoch) await connectRoom(token, url);
  })();
  try {
    await joining;
  } catch (e) {
    fail(e);
  } finally {
    joining = undefined;
    // A permission change can cancel the join while its successor waits on it.
    if (g !== epoch) void syncScreens(url).catch(fail);
  }
}
export async function selectScreenCodec(
  width = 1920,
  height = 1080,
  bitrate = 4000000,
  framerate = 30,
): Promise<VideoCodec> {
  const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
  const h264 =
    codecs.find(
      (c) =>
        c.mimeType.toLowerCase() === "video/h264" &&
        c.sdpFmtpLine?.includes("packetization-mode=1"),
    ) ?? codecs.find((c) => c.mimeType.toLowerCase() === "video/h264");
  // Prefer H.264 only when the platform reports an efficient real-time encoder.
  if (h264 && navigator.mediaCapabilities?.encodingInfo) {
    try {
      const info = await navigator.mediaCapabilities.encodingInfo({
        type: "webrtc",
        video: {
          contentType:
            h264.mimeType + (h264.sdpFmtpLine ? ";" + h264.sdpFmtpLine : ""),
          width,
          height,
          bitrate,
          framerate,
        },
      } as MediaEncodingConfiguration);
      if (info.supported && info.powerEfficient) return "h264";
    } catch {}
  }
  if (codecs.some((c) => c.mimeType.toLowerCase() === "video/vp8"))
    return "vp8";
  if (h264) return "h264";
  throw new Error("Aucun codec vidéo H.264/VP8 compatible disponible");
}
export async function startScreen(options: ScreenOptions, url: string) {
  if (useScreens.getState().busy || useScreens.getState().sharing) return;
  const s = useStore.getState(),
    self = s.users.find((u) => u.id === s.self_id),
    ch = self?.channel_id ?? "",
    limits = s.screen;
  if (!limits?.enabled || !s.channel_permissions[ch]?.["screen.share"])
    throw new Error("Partage non autorisé");
  if (!navigator.mediaDevices?.getDisplayMedia)
    throw new Error("Capture écran indisponible : mettez WebView2 à jour");
  const height = Math.min(
      options.quality === "1440p"
        ? 1440
        : options.quality === "source"
          ? limits.max_height
          : 1080,
      limits.max_height,
    ),
    fps = Math.min(options.fps, limits.max_fps);
  useScreens.setState({ busy: true, error: "" });
  // Invoke the native picker in the click handler, before any awaited network request.
  const captureEpoch = epoch;
  const capture = navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: {
      height:
        options.quality === "source"
          ? { max: height }
          : { ideal: height, max: height },
      width: { max: height * 2 },
      frameRate: { ideal: fps, max: fps },
    },
  });
  let stream: MediaStream | undefined;
  const channelAtClick = ch;
  try {
    stream = await capture;
    if (captureEpoch !== epoch) throw new Error("Partage annulé");
    const current = useStore.getState();
    if (
      current.status !== "connected" ||
      current.users.find((u) => u.id === current.self_id)?.channel_id !==
        channelAtClick
    )
      throw new Error("Le salon a changé pendant la sélection");
    if (joining) await joining;
    if (room && roomChannel !== channelAtClick) await closeScreens();
    const g = epoch;
    captured = stream;
    const grant = await request("SCREEN_START", options);
    if (g !== epoch) throw new Error("Partage annulé");
    if (!room) await connectRoom(grant, url);
    if (room) {
      for (
        let n = 0;
        n < 80 && !room.localParticipant.permissions?.canPublish;
        n++
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (g !== epoch || !room) throw new Error("Partage annulé");
    const media = stream.getVideoTracks()[0];
    if (!media) throw new Error("Aucune source vidéo sélectionnée");
    media.contentHint =
      options.content === "motion" || (options.content === "auto" && fps === 60)
        ? "motion"
        : "text";
    const video = new LocalVideoTrack(media, undefined, true);
    const settings = media.getSettings(),
      w = settings.width ?? 1920,
      h = settings.height ?? height;
    const max = Math.min(
      limits.max_bitrate,
      Math.round((h / 1080) * (fps / 30) * 4000000),
    );
    const codec = await selectScreenCodec(w, h, max, fps);
    const layers = [
      new VideoPreset(
        640,
        Math.round((640 * h) / w),
        Math.floor(Math.min(350000, max * 0.05)),
        Math.min(15, fps),
        "low",
      ),
      new VideoPreset(
        1280,
        Math.round((1280 * h) / w),
        Math.floor(Math.min(1400000, max * 0.25)),
        Math.min(30, fps),
        "low",
      ),
    ].filter((layer) => layer.width < w);
    const publication = await room.localParticipant.publishTrack(video, {
      source: Track.Source.ScreenShare,
      name: "Écran",
      videoCodec: codec,
      backupCodec: false,
      simulcast: layers.length > 0,
      screenShareEncoding: {
        maxBitrate: Math.floor(max * 0.7),
        maxFramerate: fps,
        priority: "low",
      },
      screenShareSimulcastLayers: layers,
      degradationPreference:
        media.contentHint === "motion" ? "maintain-framerate" : "balanced",
    });
    if (g !== epoch) {
      video.stop();
      return;
    }
    add(video, publication.trackSid, self!.id, self!.nickname, true);
    useScreens.setState({ sharing: true });
    media.addEventListener("ended", () => void stopScreen().catch(fail), {
      once: true,
    });
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop());
    await closeScreens();
    if (useStore.getState().status === "connected")
      await request("SCREEN_STOP").catch(() => {});
    if (!(e instanceof DOMException && e.name === "NotAllowedError")) fail(e);
  } finally {
    useScreens.setState({ busy: false });
  }
}
export async function stopScreen(notify = true) {
  useScreens.setState({ sharing: false });
  const current = room;
  captured?.getTracks().forEach((t) => t.stop());
  captured = undefined;
  if (current) {
    for (const pub of current.localParticipant.videoTrackPublications.values()) {
      if (pub.track)
        await current.localParticipant.unpublishTrack(pub.track, true);
      remove(pub.trackSid);
    }
  }
  if (notify && useStore.getState().status === "connected")
    await request("SCREEN_STOP");
}
export async function screenDiagnostics() {
  const current = room;
  if (!current) return { connected: false, tracks: [] };
  const pubs = [
    ...current.localParticipant.videoTrackPublications.values(),
    ...Array.from(current.remoteParticipants.values()).flatMap((p) => [
      ...p.videoTrackPublications.values(),
    ]),
  ];
  const tracks = [];
  for (const pub of pubs) {
    const stats = await pub.track?.getRTCStatsReport();
    const rows: any[] = [];
    stats?.forEach((item: any) => {
      if (item.type === "outbound-rtp" || item.type === "inbound-rtp") {
        rows.push({ ...item, codec: stats.get(item.codecId)?.mimeType });
      }
      if (item.type === "candidate-pair" && item.nominated)
        rows.push({
          rtt_ms: (item.currentRoundTripTime ?? 0) * 1000,
          availableOutgoingBitrate: item.availableOutgoingBitrate,
        });
    });
    tracks.push({
      sid: pub.trackSid,
      source: pub.source,
      layers:
        pub.track instanceof LocalVideoTrack
          ? pub.track.sender?.getParameters().encodings
          : undefined,
      stats: rows,
    });
  }
  return { connected: true, adaptiveStream: true, dynacast: true, tracks };
}
