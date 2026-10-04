import {
  Room,
  RoomEvent,
  Track,
  RemoteAudioTrack,
  type LocalAudioTrack,
  AudioPresets,
  createLocalAudioTrack,
} from "livekit-client";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useStore } from "./store";
import { request, report } from "./control";
let room: Room | undefined,
  generation = 0,
  held = false,
  canSpeak = false,
  chain = Promise.resolve();
const elements = new Map<string, HTMLAudioElement>();
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
function meter(id: string, track: RemoteAudioTrack | LocalAudioTrack) {
  if (!meterContext) meterContext = new AudioContext();
  const old = meters.get(id);
  old?.source.disconnect();
  const source = meterContext.createMediaStreamSource(
      new MediaStream([track.mediaStreamTrack]),
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
        if (Math.sqrt(energy / m.data.length) > 0.015) talking.push(id);
      }
      const previous = useStore.getState().talking;
      if (talking.join() !== previous.join())
        useStore.getState().set({ talking });
    }, 100);
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
      next.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.audioTrack)
          meter(next.localParticipant.identity, pub.audioTrack);
      });
      next.on(RoomEvent.LocalTrackUnpublished, () => {
        const id = next.localParticipant.identity;
        meters.get(id)?.source.disconnect();
        meters.delete(id);
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
      await updateMicrophone(false);
      await output();
      startActivation(next);
    });
  return chain;
}
async function closeRoom() {
  await stopMeters();
  stopActivation();
  const old = room;
  room = undefined;
  await old?.disconnect();
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
export async function updateMicrophone(active = true) {
  const s = useStore.getState();
  const enabled =
    canSpeak &&
    !s.users.find((u) => u.id === s.self_id)?.server_muted &&
    !s.muted &&
    !s.deafened &&
    (settings().mode === "continuous" ||
      (settings().mode === "ptt" ? held : active));
  await room?.localParticipant.setMicrophoneEnabled(enabled, capture());
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
            : volume / 100,
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
  if (settings().output && room)
    await room.switchActiveDevice("audiooutput", settings().output);
}
export async function refreshSettings() {
  await room?.localParticipant
    .getTrackPublication(Track.Source.Microphone)
    ?.audioTrack?.restartTrack(capture());
  await configurePTT();
  await output();
  await updateMicrophone();
  if (room) startActivation(room);
}
let activationTimer: ReturnType<typeof setInterval> | undefined,
  audioContext: AudioContext | undefined,
  activationStream: MediaStream | undefined;
function stopActivation() {
  clearInterval(activationTimer);
  activationStream?.getTracks().forEach((t) => t.stop());
  activationStream = undefined;
  void audioContext?.close();
  audioContext = undefined;
}
function startActivation(next: Room) {
  stopActivation();
  if (settings().mode !== "activation") return;
  void (async () => {
    activationStream = await navigator.mediaDevices.getUserMedia({
      audio: capture(),
    });
    if (room !== next) {
      stopActivation();
      return;
    }
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(activationStream),
      analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let last = 0;
    activationTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let energy = 0;
      for (const x of data) energy += x * x;
      if (Math.sqrt(energy / data.length) > settings().threshold)
        last = performance.now();
      void updateMicrophone(performance.now() - last < 250).catch(report);
    }, 50);
  })().catch(report);
}
export async function testMicrophone() {
  const track = await createLocalAudioTrack(capture());
  const e = track.attach();
  document.body.append(e);
  return () => {
    track.detach().forEach((x) => x.remove());
    track.stop();
  };
}
export async function devices() {
  return Room.getLocalDevices(undefined, true);
}
