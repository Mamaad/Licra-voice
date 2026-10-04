import {
  Room,
  RoomEvent,
  Track,
  RemoteAudioTrack,
  LocalAudioTrack,
  AudioPresets,
} from "livekit-client";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useStore } from "./store";
import { request, report } from "./control";
let room: Room | undefined,
  generation = 0,
  held = false,
  canSpeak = false,
  chain: Promise<Room | undefined | void> = Promise.resolve();
const elements = new Map<string, HTMLAudioElement>();
let microphoneStream: MediaStream | undefined,
  microphoneTrack: LocalAudioTrack | undefined,
  preview = false,
  activationUntil = 0,
  captureEpoch = 0,
  captureChain = Promise.resolve(),
  microphoneChain = Promise.resolve();
export function audioError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return new Error(
      "Accès au microphone refusé : autorisez les applications de bureau dans Windows > Confidentialité > Microphone.",
    );
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return new Error(
      "Microphone introuvable : reconnectez-le ou choisissez un autre périphérique dans les paramètres.",
    );
  if (name === "NotReadableError")
    return new Error(
      "Microphone indisponible : vérifiez le périphérique et son utilisation exclusive par une autre application.",
    );
  return error instanceof Error ? error : new Error(String(error));
}
const reportAudio = (e: unknown) => report(audioError(e));
let meterContext: AudioContext | undefined,
  meterTimer: ReturnType<typeof setInterval> | undefined;
const meters = new Map<
  string,
  {
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    data: Float32Array<ArrayBuffer>;
  }
>();
function meter(id: string, track: RemoteAudioTrack | MediaStreamTrack) {
  if (!meterContext) meterContext = new AudioContext();
  void meterContext.resume().catch(reportAudio);
  const old = meters.get(id);
  old?.source.disconnect();
  const source = meterContext.createMediaStreamSource(
      new MediaStream([
        track instanceof RemoteAudioTrack ? track.mediaStreamTrack : track,
      ]),
    ),
    analyser = meterContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  meters.set(id, {
    source,
    analyser,
    data: new Float32Array(analyser.fftSize),
  });
  if (!meterTimer)
    meterTimer = setInterval(() => {
      const talking: string[] = [];
      for (const [id, m] of meters) {
        m.analyser.getFloatTimeDomainData(m.data);
        let energy = 0;
        for (const x of m.data) energy += x * x;
        const level = Math.sqrt(energy / m.data.length);
        if (id === "microphone") {
          useStore.getState().set({ microphoneLevel: level });
          if (level >= settings().threshold)
            activationUntil = performance.now() + 250;
          if (settings().mode === "activation")
            void updateMicrophone().catch(reportAudio);
          if (
            level > 0.015 &&
            microphoneTrack &&
            !microphoneTrack.isMuted &&
            room
          )
            talking.push(room.localParticipant.identity);
        } else if (level > 0.015) talking.push(id);
      }
      const previous = useStore.getState().talking;
      if (talking.join() !== previous.join())
        useStore.getState().set({ talking });
    }, 50);
}
async function stopMeters() {
  clearInterval(meterTimer);
  meterTimer = undefined;
  for (const m of meters.values()) m.source.disconnect();
  meters.clear();
  await meterContext?.close();
  meterContext = undefined;
}

function settings() {
  return useStore.getState().settings;
}
function capture() {
  const s = settings();
  return {
    deviceId: s.input || undefined,
    channelCount: 1,
    sampleRate: 48000,
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
  };
}
const profiles = { eco: 24000, standard: 32000, high: 64000 };
export function joinVoice(
  url: string,
  p: {
    token: string;
    channel_id: string;
    audio_profile: keyof typeof profiles;
    can_speak: boolean;
  },
) {
  const g = ++generation;
  chain = chain
    .catch(() => {})
    .then(async () => {
      await closeRoom();
      if (g !== generation) return;
      canSpeak = p.can_speak;
      const next = new Room({
        webAudioMix: true,
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: capture(),
        publishDefaults: {
          audioPreset: {
            ...AudioPresets.speech,
            maxBitrate: profiles[p.audio_profile],
          },
          dtx: true,
          red: true,
          forceStereo: false,
          stopMicTrackOnMute: false,
        },
      });
      room = next;
      next.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const audio = track.attach() as HTMLAudioElement;
        audio.hidden = true;
        document.body.append(audio);
        elements.set(participant.identity, audio);
        if (track instanceof RemoteAudioTrack)
          meter(participant.identity, track);
        void output().catch(report);
        localVolumes();
      });
      next.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        track.detach().forEach((e) => e.remove());
        elements.delete(participant.identity);
        meters.get(participant.identity)?.source.disconnect();
        meters.delete(participant.identity);
      });

      next.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.track === microphoneTrack) {
          microphoneTrack?.stop();
          microphoneTrack = undefined;
        }
      });
      next.on(RoomEvent.Disconnected, () => {
        if (room === next) {
          useStore.getState().set({ talking: [] });
          room = undefined;
        }
      });
      await next.connect(url, p.token, { autoSubscribe: true });
      if (g !== generation) {
        await next.disconnect();
        return;
      }
      await next.startAudio();
      await configurePTT();
      if (canSpeak)
        await ensureMicrophone().catch((e) => {
          throw audioError(e);
        });
      await updateMicrophone();
      await output();
      return next;
    });
  return chain;
}
async function closeRoom() {
  const old = room;
  room = undefined;
  releaseMicrophone();
  if (!preview) await stopMeters();
  await old?.disconnect();
  microphoneTrack?.stop();
  microphoneTrack = undefined;
  for (const [id, m] of meters)
    if (id !== "microphone") {
      m.source.disconnect();
      meters.delete(id);
    }
  for (const e of elements.values()) e.remove();
  elements.clear();
  await unregisterAll();
  held = false;
  useStore.getState().set({ talking: [] });
}
export async function leaveVoice() {
  generation++;
  chain = chain.catch(() => {}).then(closeRoom);
  await chain;
}
export async function configurePTT() {
  await unregisterAll();
  held = false;
  if (settings().mode === "ptt")
    await register(settings().shortcut, (event) => {
      held = event.state === "Pressed";
      void updateMicrophone().catch(report);
    });
}
export function updateMicrophone() {
  microphoneChain = microphoneChain
    .catch(() => {})
    .then(async () => {
      const s = useStore.getState();
      const enabled =
        canSpeak &&
        !s.users.find((u) => u.id === s.self_id)?.server_muted &&
        !s.muted &&
        !s.deafened &&
        (settings().mode === "continuous" ||
          (settings().mode === "ptt"
            ? held
            : performance.now() < activationUntil));
      if (!microphoneTrack || microphoneTrack.isMuted === !enabled) return;
      if (enabled) await microphoneTrack.unmute();
      else await microphoneTrack.mute();
    });
  return microphoneChain;
}
export async function syncVoicePermissions() {
  const s = useStore.getState(),
    self = s.users.find((u) => u.id === s.self_id);
  if (!room || !self?.channel_id) return;
  canSpeak =
    !!s.channel_permissions[self.channel_id]?.["voice.speak"] &&
    !self.server_muted;
  if (canSpeak && !microphoneTrack) await ensureMicrophone();
  await updateMicrophone();
}
export async function toggleMute() {
  const s = useStore.getState();
  s.set({ muted: !s.muted });
  await updateMicrophone();
  if (s.status === "connected")
    await request("VOICE_STATE", { muted: !s.muted, deafened: s.deafened });
}
export async function toggleDeafen() {
  const s = useStore.getState();
  s.set({ deafened: !s.deafened });
  localVolumes();
  await updateMicrophone();
  if (s.status === "connected")
    await request("VOICE_STATE", { muted: s.muted, deafened: !s.deafened });
}
export function localVolumes() {
  const s = useStore.getState();
  for (const [id, a] of elements) {
    const participant = room?.remoteParticipants.get(id);
    const user = s.users.find((u) => u.id === id);
    const volume = user ? (s.volumes[user.fingerprint] ?? 100) : 100;
    for (const pub of participant?.audioTrackPublications.values() ?? []) {
      if (pub.track instanceof RemoteAudioTrack)
        pub.track.setVolume(
          s.deafened || s.localMuted[user?.fingerprint ?? ""]
            ? 0
            : ((volume / 100) * s.masterVolume) / 100,
        );
    }
    a.muted = true;
  }
}
export function setVolume(user: string, value: number) {
  const s = useStore.getState();
  const volumes = { ...s.volumes, [user]: value };
  s.set({ volumes });
  localStorage.setItem("volumes", JSON.stringify(volumes));
  localVolumes();
}
export async function output() {
  if (room)
    await room.switchActiveDevice(
      "audiooutput",
      settings().output || "default",
    );
}
function releaseMicrophone() {
  if (preview || (room && canSpeak)) return;
  captureEpoch++;
  microphoneStream?.getTracks().forEach((t) => t.stop());
  microphoneStream = undefined;
  meters.get("microphone")?.source.disconnect();
  meters.delete("microphone");
  useStore.getState().set({ microphoneLevel: 0 });
}
async function ensureMicrophone(force = false) {
  const epoch = captureEpoch;
  captureChain = captureChain
    .catch(() => {})
    .then(async () => {
      if (epoch !== captureEpoch || (!preview && !(room && canSpeak))) return;
      if (
        force ||
        !microphoneStream ||
        microphoneStream.getAudioTracks()[0]?.readyState !== "live"
      ) {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: capture(),
          video: false,
        });
        if (epoch !== captureEpoch || (!preview && !(room && canSpeak))) {
          next.getTracks().forEach((t) => t.stop());
          return;
        }
        const previous = microphoneStream;
        microphoneStream = next;
        activationUntil = 0;
        meter("microphone", next.getAudioTracks()[0]);
        if (microphoneTrack && room) {
          const old = microphoneTrack.mediaStreamTrack;
          await microphoneTrack.replaceTrack(
            next.getAudioTracks()[0].clone(),
            true,
          );
          old.stop();
        }
        previous?.getTracks().forEach((t) => t.stop());
      }
      if (room && canSpeak && !microphoneTrack && microphoneStream) {
        const target = room;
        const track = new LocalAudioTrack(
          microphoneStream.getAudioTracks()[0].clone(),
          undefined,
          true,
        );
        await track.mute(); // Publish muted: PTT and activation must never leak initial audio.
        try {
          await target.localParticipant.publishTrack(track, {
            source: Track.Source.Microphone,
          });
          if (room !== target) {
            track.stop();
            return;
          }
          microphoneTrack = track;
        } catch (e) {
          track.stop();
          throw e;
        }
      }
    });
  await captureChain;
}
export function startMicrophonePreview() {
  preview = true;
  return ensureMicrophone();
}
export function stopMicrophonePreview() {
  preview = false;
  releaseMicrophone();
  if (!room) void stopMeters();
}
export async function refreshSettings(
  patch: Partial<ReturnType<typeof settings>>,
) {
  if (
    ["input", "echoCancellation", "noiseSuppression", "autoGainControl"].some(
      (k) => k in patch,
    )
  )
    await ensureMicrophone(true);
  if ("mode" in patch || "shortcut" in patch) {
    activationUntil = 0;
    await configurePTT();
  }
  if ("output" in patch) await output();
  await updateMicrophone();
}
export async function testMicrophone() {
  await ensureMicrophone();
  if (!microphoneStream) throw new Error("Microphone indisponible");
  const audio = new Audio();
  audio.srcObject = microphoneStream;
  const sink = audio as HTMLAudioElement & {
    setSinkId?: (id: string) => Promise<void>;
  };
  if (sink.setSinkId) await sink.setSinkId(settings().output || "default");
  await audio.play();
  return () => {
    audio.pause();
    audio.srcObject = null;
  };
}
export async function devices() {
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind !== "videoinput",
  );
}

export function setMasterVolume(value: number) {
  useStore.getState().set({ masterVolume: value });
  localStorage.setItem("masterVolume", String(value));
  localVolumes();
}
let diagnosticSample:
  | { generation: number; at: number; received: number; sent: number }
  | undefined;
export async function voiceDiagnostics() {
  if (!room) {
    diagnosticSample = undefined;
    return {
      connected: false,
      remoteParticipants: 0,
      codec: null,
      transport: null,
      rtt_ms: null,
      jitter_ms: null,
      packet_loss_percent: null,
      packets_received: null,
      packets_lost: null,
      receive_kbps: null,
      send_kbps: null,
    };
  }
  const current = room,
    epoch = generation;
  const tracks = [
    ...current.localParticipant.audioTrackPublications.values(),
    ...Array.from(current.remoteParticipants.values()).flatMap((p) => [
      ...p.audioTrackPublications.values(),
    ]),
  ];
  const reports = await Promise.all(
    tracks.map((p) => p.track?.getRTCStatsReport()),
  );
  let received = 0,
    lost = 0,
    jitter = 0,
    codec = "",
    transport = "",
    rtt: number | null = null,
    bytesReceived = 0,
    bytesSent = 0,
    inbound = false,
    outbound = false;
  const seen = new Set<string>();
  for (const stats of reports) {
    if (!stats) continue;
    stats.forEach((item: any) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      if (
        item.type === "inbound-rtp" &&
        (item.kind === "audio" || item.mediaType === "audio")
      ) {
        inbound = true;
        received += item.packetsReceived ?? 0;
        lost += Math.max(0, item.packetsLost ?? 0);
        jitter = Math.max(jitter, item.jitter ?? 0);
        bytesReceived += item.bytesReceived ?? 0;
      }
      if (
        item.type === "outbound-rtp" &&
        (item.kind === "audio" || item.mediaType === "audio")
      ) {
        outbound = true;
        bytesSent += item.bytesSent ?? 0;
      }
      if (
        item.type === "codec" &&
        item.mimeType?.toLowerCase().includes("opus")
      )
        codec = item.mimeType;
      if (
        item.type === "candidate-pair" &&
        item.state === "succeeded" &&
        (item.nominated || item.selected)
      ) {
        if (item.currentRoundTripTime != null)
          rtt = Math.round(item.currentRoundTripTime * 1000);
        transport = stats.get(item.localCandidateId)?.protocol ?? transport;
      }
    });
  }
  const at = performance.now(),
    previous = diagnosticSample,
    elapsed = previous?.generation === epoch ? (at - previous.at) / 1000 : 0;
  const rate = (bytes: number, old: number | undefined) =>
    elapsed > 0 && old !== undefined && bytes >= old
      ? +(((bytes - old) * 8) / elapsed / 1000).toFixed(1)
      : null;
  const receive_kbps = inbound ? rate(bytesReceived, previous?.received) : null,
    send_kbps = outbound ? rate(bytesSent, previous?.sent) : null;
  if (room === current && epoch === generation)
    diagnosticSample = {
      generation: epoch,
      at,
      received: bytesReceived,
      sent: bytesSent,
    };
  return {
    connected: room === current && epoch === generation,
    remoteParticipants: current.remoteParticipants.size,
    codec: codec || null,
    transport: transport || null,
    rtt_ms: rtt,
    jitter_ms: inbound ? +(jitter * 1000).toFixed(2) : null,
    packet_loss_percent:
      received + lost ? +((lost / (received + lost)) * 100).toFixed(2) : null,
    packets_received: inbound ? received : null,
    packets_lost: inbound ? lost : null,
    receive_kbps,
    send_kbps,
  };
}
