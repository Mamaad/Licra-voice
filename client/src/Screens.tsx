import { useEffect, useRef, useState } from "react";
import { useFullscreen } from "./useFullscreen";
import { useStore } from "./store";
import {
  useScreens,
  startScreen,
  stopScreen,
  screenDiagnostics,
  type ScreenItem,
  type ScreenOptions,
} from "./screen";
import { request, mediaBase } from "./control";
import { Modal } from "./Modal";
function ScreenTile({
  item,
  focused,
  onFocus,
  onError,
}: {
  item: ScreenItem;
  focused: boolean;
  onFocus: () => void;
  onError: (s: string) => void;
}) {
  const fullscreen = useFullscreen();
  const [fit, setFit] = useState(false);
  const element = useRef<HTMLVideoElement>(null),
    s = useStore();
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    item.track.attach(el);
    el.muted = true;
    void el.play().catch(() => {});
    return () => {
      item.track.detach(el);
    };
  }, [item.track]);
  const p =
    s.channel_permissions[
      s.users.find((u) => u.id === s.self_id)?.channel_id ?? ""
    ] ?? {};
  return (
    <div
      className={`screen-tile ${focused ? "focused" : ""} ${fit ? "fit-video" : ""}`}
      ref={fullscreen.container}
      onDoubleClick={onFocus}
    >
      <header>
        <strong>
          {item.nickname}
          {item.local ? " · vous" : ""}
        </strong>
        <button onClick={onFocus}>
          {focused ? "Grille" : "Focus / épingler"}
        </button>
        <button
          onClick={() =>
            void fullscreen.toggle().catch((e) => onError(String(e)))
          }
        >
          {fullscreen.active ? "Quitter le plein écran" : "Plein écran"}
        </button>
        {fullscreen.active && (
          <button onClick={() => setFit(!fit)}>
            {fit ? "Remplir l’écran" : "Tout afficher"}
          </button>
        )}
        {!item.local && p["screen.stop_others"] && (
          <button
            onClick={() =>
              void request("SCREEN_STOP", { user_id: item.userId }).catch((e) =>
                onError(String(e)),
              )
            }
          >
            Arrêter
          </button>
        )}
      </header>
      <video ref={element} autoPlay playsInline muted />
    </div>
  );
}
export function ScreenPanel({ channelId }: { channelId: string }) {
  const s = useStore(),
    screen = useScreens(),
    [options, setOptions] = useState<ScreenOptions>({
      quality: "auto",
      fps: 30,
      content: "auto",
    }),
    [focus, setFocus] = useState(""),
    [debug, setDebug] = useState(false),
    [stats, setStats] = useState<any>(null);
  const self = s.users.find((u) => u.id === s.self_id),
    p = s.channel_permissions[channelId] ?? {},
    joined = self?.channel_id === channelId;
  const tracks = screen.tracks.filter(
    (t) => s.users.find((u) => u.id === t.userId)?.channel_id === channelId,
  );
  useEffect(() => {
    if (focus && !tracks.some((t) => t.key === focus)) setFocus("");
  }, [tracks, focus]);
  useEffect(() => {
    if (!debug) return;
    let alive = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await screenDiagnostics();
        if (alive) setStats(value);
      } catch (e) {
        if (alive) setStats({ error: String(e) });
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [debug]);
  if (!s.screen?.enabled) return null;
  return (
    <section className="screen-panel" aria-label="Partage d’écran">
      <div className="members-heading">
        <h2>Partages d’écran</h2>
        {tracks.length > 0 && (
          <button onClick={() => setDebug(true)}>Diagnostics vidéo</button>
        )}
      </div>
      {joined && p["screen.share"] && (
        <div className="screen-controls">
          <label>
            Qualité
            <select
              aria-label="Qualité écran"
              value={options.quality}
              disabled={screen.sharing || screen.busy}
              onChange={(e) =>
                setOptions({
                  ...options,
                  quality: e.target.value as ScreenOptions["quality"],
                })
              }
            >
              <option value="auto">Auto</option>
              {(s.screen.max_height ?? 0) >= 1080 && (
                <option value="1080p">1080p</option>
              )}
              {(s.screen.max_height ?? 0) >= 1440 && (
                <option value="1440p">1440p</option>
              )}
              <option value="source">Source (compressée)</option>
            </select>
          </label>
          <label>
            Images/s
            <select
              aria-label="FPS écran"
              value={options.fps}
              disabled={screen.sharing || screen.busy}
              onChange={(e) =>
                setOptions({
                  ...options,
                  fps: Number(e.target.value) as 30 | 60,
                })
              }
            >
              <option value={30}>30 FPS</option>
              {(s.screen.max_fps ?? 0) >= 60 && (
                <option value={60}>60 FPS</option>
              )}
            </select>
          </label>
          <label>
            Contenu
            <select
              value={options.content}
              disabled={screen.sharing || screen.busy}
              onChange={(e) =>
                setOptions({
                  ...options,
                  content: e.target.value as ScreenOptions["content"],
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="text">Texte / bureau</option>
              <option value="motion">Mouvement / jeu</option>
            </select>
          </label>
          <button
            className={screen.sharing ? "danger-text" : "primary"}
            disabled={screen.busy}
            onClick={() =>
              void (
                screen.sharing
                  ? stopScreen()
                  : startScreen(options, mediaBase())
              ).catch((e) => useScreens.setState({ error: String(e) }))
            }
          >
            {screen.busy
              ? "Sélection en cours…"
              : screen.sharing
                ? "Arrêter le partage"
                : "Partager l’écran"}
          </button>
        </div>
      )}
      {screen.error && (
        <p role="alert" className="danger-text">
          {screen.error}
        </p>
      )}
      {!joined && screen.shares.some((t) => t.channel_id === channelId) && (
        <p>Rejoignez le salon vocal pour regarder les partages autorisés.</p>
      )}
      <div
        className={`screen-grid ${tracks.length === 1 ? "single" : ""} ${focus ? "has-focus" : ""}`}
      >
        {tracks.map((item) => (
          <ScreenTile
            key={item.key}
            item={item}
            focused={focus === item.key}
            onFocus={() => setFocus(focus === item.key ? "" : item.key)}
            onError={(error) => useScreens.setState({ error })}
          />
        ))}
      </div>
      {debug && (
        <Modal title="Diagnostics écran" onClose={() => setDebug(false)}>
          <pre className="screen-diagnostics">
            {JSON.stringify(stats, null, 2)}
          </pre>
        </Modal>
      )}
    </section>
  );
}
