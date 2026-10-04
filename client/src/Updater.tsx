import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Modal } from "./Modal";
import { CLIENT_VERSION } from "./version";
export function Updater() {
  const [update, setUpdate] = useState<Update | null>(null),
    [visible, show] = useState(false),
    [message, setMessage] = useState(""),
    [checking, setChecking] = useState(false),
    [progress, setProgress] = useState<number | null>(0),
    [busy, setBusy] = useState(false);
  const installing = useRef(false);
  useEffect(() => {
    let alive = true,
      looking = false;
    async function look(event?: Event) {
      if (looking || installing.current) {
        if (event) show(true);
        return;
      }
      looking = true;
      setChecking(true);
      if (event) {
        show(true);
        setMessage("Recherche d’une mise à jour…");
      }
      try {
        const next = await check();
        if (!alive) {
          await next?.close();
          return;
        }
        setUpdate((previous) => {
          if (previous !== next) void previous?.close();
          return next;
        });
        setMessage(
          next
            ? "Nouvelle version disponible."
            : `Licra ${CLIENT_VERSION} est à jour.`,
        );
        if (next) show(true);
      } catch (e) {
        if (alive)
          setMessage("Impossible de vérifier les mises à jour : " + String(e));
      } finally {
        looking = false;
        if (alive) setChecking(false);
      }
    }
    void look();
    const timer = setInterval(() => void look(), 6 * 60 * 60 * 1000);
    const handler = (e: Event) => void look(e);
    window.addEventListener("licra:check-update", handler);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("licra:check-update", handler);
    };
  }, []);
  async function install() {
    if (!update || busy) return;
    installing.current = true;
    setBusy(true);
    setMessage("Téléchargement et vérification de la signature…");
    let downloaded = 0,
      total = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
          setProgress(total ? 0 : null);
        }
        if (e.event === "Progress") {
          downloaded += e.data.chunkLength;
          setProgress(total ? Math.round((downloaded / total) * 100) : null);
        }
        if (e.event === "Finished") {
          setProgress(100);
          setMessage("Installation puis redémarrage de Licra…");
        }
      });
      await relaunch();
    } catch (e) {
      setMessage("Mise à jour impossible : " + String(e));
      installing.current = false;
      setBusy(false);
    }
  }
  return visible ? (
    <Modal
      title={
        update
          ? "Nouvelle version · v" + update.version
          : "Mise à jour de Licra"
      }
      onClose={() => !busy && show(false)}
    >
      <p role="status">{message}</p>
      {update && (
        <p style={{ whiteSpace: "pre-wrap" }}>
          {update.body ?? "Nouvelle release Licra"}
        </p>
      )}
      {busy ? (
        <>
          <progress max="100" value={progress ?? undefined} />
          <p>
            {progress === null ? "Téléchargement en cours…" : progress + "%"}
          </p>
        </>
      ) : (
        update && (
          <>
            <button onClick={() => show(false)}>Plus tard</button>
            <button disabled={checking} onClick={() => void install()}>
              Télécharger, installer et redémarrer
            </button>
          </>
        )
      )}
    </Modal>
  ) : null;
}
