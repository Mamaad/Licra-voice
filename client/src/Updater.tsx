import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Modal } from "./Modal";
import { report } from "./control";
export function Updater() {
  const [update, setUpdate] = useState<Update | null>(null),
    [visible, show] = useState(false),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    async function look(event?: Event) {
      try {
        const next = await check();
        if (alive && next) {
          setUpdate(next);
          show(true);
        } else if (event && alive)
          report(new Error("Votre client est à jour."));
      } catch (e) {
        if (event && alive) report(e);
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
    if (!update) return;
    setBusy(true);
    let downloaded = 0,
      total = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          downloaded += e.data.chunkLength;
          setProgress(total ? Math.round((downloaded / total) * 100) : 0);
        }
        if (e.event === "Finished") setProgress(100);
      });
      await relaunch();
    } catch (e) {
      report(e);
      setBusy(false);
    }
  }
  return visible && update ? (
    <Modal
      title={"Nouvelle version disponible · v" + update.version}
      onClose={() => !busy && show(false)}
    >
      <p>{update.body ?? "Nouvelle release Licra"}</p>
      {busy ? (
        <>
          <progress max="100" value={progress} />
          <p>{progress}%</p>
        </>
      ) : (
        <>
          <button onClick={() => show(false)}>Plus tard</button>
          <button onClick={() => void install()}>
            Télécharger et installer
          </button>
        </>
      )}
    </Modal>
  ) : null;
}
