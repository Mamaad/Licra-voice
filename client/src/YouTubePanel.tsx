import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { useScreens } from "./screen";
import { ScreenPanel } from "./Screens";
import {
  useYouTube,
  youtubeAction,
  youtubePosition,
  parseYouTubeID,
} from "./youtube";
import { driftNeedsSeek } from "./youtube-sync.mjs";
import { useFullscreen } from "./useFullscreen";
let api: Promise<any> | undefined;
function loadAPI(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (api) return api;
  api = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      script.remove();
      api = undefined;
      reject(new Error("YouTube ne répond pas. Vérifiez votre connexion."));
    }, 15000);
    w.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve(w.YT);
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      api = undefined;
      reject(new Error("Impossible de charger le lecteur YouTube."));
    };
    document.head.appendChild(script);
  });
  return api;
}
function time(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const errors: Record<number, string> = {
  2: "Vidéo YouTube invalide.",
  5: "Lecture non prise en charge par ce lecteur.",
  100: "Vidéo supprimée ou privée.",
  101: "Le créateur interdit la lecture intégrée.",
  150: "Le créateur interdit la lecture intégrée.",
  153: "YouTube n’a pas reconnu l’application. Mettez Licra/WebView2 à jour.",
};
export function YouTubePanel({ channelId }: { channelId: string }) {
  const s = useStore(),
    y = useYouTube(),
    fs = useFullscreen();
  const self = s.users.find((u) => u.id === s.self_id),
    p = s.channel_permissions[channelId] ?? {};
  const joined = self?.channel_id === channelId;
  const a = y.activity?.channel_id === channelId ? y.activity : null;
  const [url, setURL] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false),
    [retry, setRetry] = useState(0);
  const [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0),
    [seeking, setSeeking] = useState<number | null>(null),
    [debug, setDebug] = useState(false);
  const mount = useRef<HTMLDivElement>(null),
    player = useRef<any>(null),
    sync = useRef<(force?: boolean) => void>(() => {});
  const active =
    !!a?.video_id && a.state !== "STOPPED" && joined && !!p["youtube.view"];
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  async function action(type: string, payload: Record<string, unknown> = {}) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await youtubeAction(type, payload);
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!active || !mount.current) return;
    let alive = true,
      ready = false,
      loaded = "",
      lastSeek = 0,
      revision = -1,
      autoplayBlocked = false;
    let yt: any,
      clock: ReturnType<typeof setInterval> | undefined,
      metadataRevision = -1;
    const apply = (force = false) => {
      const state = useYouTube.getState(),
        current = state.activity;
      if (!alive || !ready || !current || current.channel_id !== channelId)
        return;
      const expected = youtubePosition(current);
      if (loaded !== current.video_id) {
        loaded = current.video_id;
        revision = current.revision;
        metadataRevision = -1;
        lastSeek = performance.now();
        autoplayBlocked = false;
        setBlocked(false);
        setError("");
        if (current.state === "PLAYING")
          yt.loadVideoById({ videoId: loaded, startSeconds: expected });
        else yt.cueVideoById({ videoId: loaded, startSeconds: expected });
        return;
      }
      const actual = yt.getCurrentTime(),
        drift = actual - expected;
      useYouTube.setState({ drift: drift * 1000 });
      const changed = revision !== current.revision;
      revision = current.revision;
      if (
        !autoplayBlocked &&
        (force ||
          ((changed || performance.now() - lastSeek > 8000) &&
            (driftNeedsSeek(drift) ||
              (current.state === "PAUSED" && Math.abs(drift) > 0.25))))
      ) {
        lastSeek = performance.now();
        yt.seekTo(expected, true);
      }
      const status = yt.getPlayerState();
      if (current.state === "PAUSED" && status !== 2) yt.pauseVideo();
      if (
        current.state === "PLAYING" &&
        !autoplayBlocked &&
        status !== 1 &&
        status !== 3 &&
        status !== 0
      )
        yt.playVideo();
      const length = yt.getDuration();
      setDuration(length > 0 ? length : current.duration);
      setPosition(actual);
      // Official duration is supplied once by a client allowed to change the video.
      // A single server deadline advances the canonical queue, even after that client leaves.
      if (
        length > 0 &&
        current.duration === 0 &&
        (useStore.getState().channel_permissions[channelId]?.[
          "youtube.change_video"
        ] ||
          (current.started_by ===
            useStore
              .getState()
              .users.find((u) => u.id === useStore.getState().self_id)
              ?.fingerprint &&
            useStore.getState().channel_permissions[channelId]?.[
              "youtube.start"
            ])) &&
        metadataRevision !== current.revision
      ) {
        metadataRevision = current.revision;
        void youtubeAction("YOUTUBE_DURATION", { duration: length }).catch(
          () => {},
        );
      }
    };
    sync.current = (force) => {
      if (force) {
        autoplayBlocked = false;
        setBlocked(false);
      }
      apply(force);
    };
    void loadAPI()
      .then((YT) => {
        if (!alive) return;
        const node = document.createElement("div");
        mount.current?.appendChild(node);
        yt = new YT.Player(node, {
          width: "100%",
          height: "100%",
          playerVars: {
            playsinline: 1,
            controls: 1,
            disablekb: 1,
            rel: 0,
            origin: window.location.origin,
            widget_referrer: "https://org.licra.voice",
          },
          events: {
            onReady: () => {
              if (!alive) return;
              player.current = yt;
              ready = true;
              yt.setVolume(useYouTube.getState().volume);
              if (useYouTube.getState().muted) yt.mute();
              apply(true);
              clock = setInterval(() => apply(), 1000);
            },
            onAutoplayBlocked: () => {
              autoplayBlocked = true;
              setBlocked(true);
            },
            onError: (event: any) => {
              setError(
                errors[event.data] ??
                  `Erreur du lecteur YouTube (${event.data}).`,
              );
              autoplayBlocked = true;
            },
            onStateChange: (event: any) => {
              if (!alive || !ready) return;
              const current = useYouTube.getState().activity;
              if (!current || current.video_id !== loaded) return;
              if (event.data === 1) setBlocked(false);
              if (
                event.data === 0 &&
                current.state === "PLAYING" &&
                current.duration > 0 &&
                useStore.getState().channel_permissions[channelId]?.[
                  "youtube.control"
                ]
              )
                void youtubeAction("YOUTUBE_ENDED").catch(() => {});
            },
          },
        });
      })
      .catch((e) => {
        if (alive) report(e);
      });
    return () => {
      alive = false;
      clearInterval(clock);
      ready = false;
      sync.current = () => {};
      player.current = null;
      yt?.destroy();
      mount.current?.replaceChildren();
      useYouTube.setState({ drift: null });
    };
  }, [active, channelId, retry]);
  useEffect(() => {
    if (active) sync.current();
  }, [a?.revision]);
  useEffect(() => {
    player.current?.setVolume(y.volume);
    if (y.muted) player.current?.mute();
    else player.current?.unMute();
  }, [y.volume, y.muted]);
  if (!s.youtube?.enabled || !joined || !p["youtube.view"]) return null;
  const canStart =
    a?.video_id && a.state !== "STOPPED"
      ? p["youtube.change_video"]
      : p["youtube.start"];
  return (
    <section className="youtube-panel" aria-label="YouTube synchronisé">
      <div className="members-heading">
        <h2>YouTube · regarder ensemble</h2>
        {active && (
          <button onClick={() => setDebug(!debug)}>Diagnostics YouTube</button>
        )}
      </div>
      {(canStart || p["youtube.queue_manage"]) && (
        <form
          className="youtube-input"
          onSubmit={(e) => {
            e.preventDefault();
            const id = parseYouTubeID(url.trim());
            if (!id) {
              setError("Collez un lien YouTube valide.");
              return;
            }
            void action("YOUTUBE_START", { video: id }).then((ok) => {
              if (ok) setURL("");
            });
          }}
        >
          <input
            aria-label="Lien YouTube"
            placeholder="Collez un lien YouTube…"
            value={url}
            maxLength={2048}
            onChange={(e) => setURL(e.target.value)}
          />
          {canStart && (
            <button
              className="primary"
              disabled={busy || !parseYouTubeID(url.trim())}
            >
              Regarder ensemble
            </button>
          )}
          {p["youtube.queue_manage"] && (
            <button
              type="button"
              disabled={busy || !parseYouTubeID(url.trim())}
              onClick={() =>
                void action("YOUTUBE_QUEUE_ADD", {
                  video: parseYouTubeID(url.trim()),
                }).then((ok) => {
                  if (ok) setURL("");
                })
              }
            >
              Ajouter à la file
            </button>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="danger-text">
          {error}{" "}
          {active && (
            <button
              onClick={() => {
                setError("");
                setRetry(retry + 1);
              }}
            >
              Réessayer le lecteur
            </button>
          )}
        </p>
      )}
      {active && (
        <>
          {blocked && (
            <button className="primary" onClick={() => sync.current(true)}>
              Cliquez pour démarrer la lecture synchronisée
            </button>
          )}
          <div className="youtube-video" ref={fs.container}>
            <div className="youtube-mount" ref={mount} />
            <button
              className="youtube-fullscreen"
              onClick={() => void fs.toggle().catch(report)}
            >
              {fs.active ? "Quitter le plein écran" : "Plein écran YouTube"}
            </button>
          </div>
          <div className="youtube-global-controls">
            <strong>Vidéo {a.video_id}</strong>
            <button
              disabled={
                busy || !p["youtube.change_video"] || !a.previous.length
              }
              onClick={() => void action("YOUTUBE_PREVIOUS")}
            >
              Précédente
            </button>
            <button
              disabled={busy || !p["youtube.control"]}
              onClick={() =>
                void action(
                  a.state === "PLAYING" ? "YOUTUBE_PAUSE" : "YOUTUBE_PLAY",
                )
              }
            >
              {a.state === "PLAYING"
                ? "Pause pour le salon"
                : "Lecture pour le salon"}
            </button>
            <button
              disabled={busy || !p["youtube.change_video"] || !a.queue.length}
              onClick={() => void action("YOUTUBE_NEXT")}
            >
              Suivante
            </button>
            <button
              disabled={busy || !p["youtube.stop"]}
              onClick={() => void action("YOUTUBE_STOP")}
            >
              Arrêter YouTube
            </button>
          </div>
          <label className="youtube-timeline">
            Position partagée · {time(seeking ?? position)} / {time(duration)}
            <input
              aria-label="Position YouTube"
              type="range"
              min={0}
              max={Math.max(1, duration)}
              step={0.1}
              value={Math.min(seeking ?? position, Math.max(1, duration))}
              disabled={
                busy ||
                duration <= 0 ||
                !p["youtube.seek"] ||
                !p["youtube.control"]
              }
              onChange={(e) => setSeeking(Number(e.target.value))}
              onPointerUp={(e) => {
                const target = Number(e.currentTarget.value);
                setSeeking(null);
                void action("YOUTUBE_SEEK", { position: target });
              }}
              onKeyUp={(e) => {
                if (
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                  ].includes(e.key)
                ) {
                  setSeeking(null);
                  void action("YOUTUBE_SEEK", {
                    position: Number(e.currentTarget.value),
                  });
                }
              }}
            />
          </label>
          <div className="youtube-local-controls">
            <label>
              Volume YouTube (local) · {y.volume}%
              <input
                aria-label="Volume YouTube"
                type="range"
                min={0}
                max={100}
                value={y.volume}
                onChange={(e) => {
                  const volume = Number(e.target.value);
                  useYouTube.setState({ volume });
                  localStorage.setItem("youtubeVolume", String(volume));
                }}
              />
            </label>
            <button
              aria-pressed={y.muted}
              onClick={() => {
                useYouTube.setState({ muted: !y.muted });
                localStorage.setItem("youtubeMuted", String(!y.muted));
              }}
            >
              {y.muted ? "Réactiver YouTube" : "Couper YouTube localement"}
            </button>
          </div>
        </>
      )}
      {!!a?.queue.length && (
        <div className="youtube-queue">
          <div className="members-heading">
            <h3>À suivre ({a.queue.length})</h3>
            {p["youtube.queue_manage"] && (
              <button
                disabled={busy}
                onClick={() => void action("YOUTUBE_QUEUE_CLEAR")}
              >
                Vider la file
              </button>
            )}
          </div>
          <ol>
            {a.queue.map((id, index) => (
              <li key={`${index}:${id}`}>
                <span>{id}</span>
                {p["youtube.queue_manage"] && (
                  <>
                    <button
                      aria-label={`Monter la vidéo ${index + 1}`}
                      disabled={busy || index === 0}
                      onClick={() =>
                        void action("YOUTUBE_QUEUE_MOVE", {
                          index,
                          to: index - 1,
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Descendre la vidéo ${index + 1}`}
                      disabled={busy || index === a.queue.length - 1}
                      onClick={() =>
                        void action("YOUTUBE_QUEUE_MOVE", {
                          index,
                          to: index + 1,
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action("YOUTUBE_QUEUE_REMOVE", { index })
                      }
                    >
                      Retirer
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {!active && !a?.queue.length && (
        <small className="muted-text">
          Une activité YouTube sera affichée ici lorsqu’un membre autorisé la
          démarre.
        </small>
      )}
      {debug && (
        <pre className="screen-diagnostics">
          {JSON.stringify(
            {
              revision: a?.revision,
              drift_ms: y.drift,
              clock_offset_ms: y.offset,
              rtt_ms: y.rtt,
              canonical_position: youtubePosition(a),
              player_position: position,
              autoplay_blocked: blocked,
            },
            null,
            2,
          )}
        </pre>
      )}
    </section>
  );
}
export function ChannelActivities({ channelId }: { channelId: string }) {
  const s = useStore(),
    y = useYouTube(),
    screens = useScreens();
  const joined =
    s.users.find((u) => u.id === s.self_id)?.channel_id === channelId;
  const showYouTube =
    joined &&
    s.youtube?.enabled &&
    s.channel_permissions[channelId]?.["youtube.view"];
  const shared = screens.shares.some((share) => share.channel_id === channelId);
  const active =
    showYouTube &&
    y.activity?.channel_id === channelId &&
    y.activity.state !== "STOPPED";
  if (!showYouTube) return <ScreenPanel channelId={channelId} />;
  return (
    <>
      <div
        className="activity-tabs"
        role="group"
        aria-label="Activité principale"
      >
        <button
          aria-pressed={y.preferred === "youtube"}
          onClick={() => useYouTube.setState({ preferred: "youtube" })}
        >
          YouTube {active ? "· en cours" : ""}
        </button>
        <button
          aria-pressed={y.preferred === "screens"}
          onClick={() => useYouTube.setState({ preferred: "screens" })}
        >
          Partages d’écran {shared ? "· en cours" : ""}
        </button>
      </div>
      {y.preferred === "youtube" && (
        <YouTubePanel key={channelId} channelId={channelId} />
      )}
      <div hidden={!!active && y.preferred === "youtube"}>
        <ScreenPanel channelId={channelId} />
      </div>
    </>
  );
}
