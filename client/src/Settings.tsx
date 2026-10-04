import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import {
  devices,
  refreshSettings,
  testMicrophone,
  startMicrophonePreview,
  stopMicrophonePreview,
  audioError,
} from "./voice";
import { report, request } from "./control";
import { Modal, promptDialog, confirmDialog } from "./Modal";
import { Icon } from "./ui";
export function Settings({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState("audio");
  const db = (level: number) =>
    Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(0.001, level))));
  const levelPercent = ((db(s.microphoneLevel) + 60) / 60) * 100;
  const thresholdPercent = ((db(s.settings.threshold) + 60) / 60) * 100;
  const [list, setList] = useState<MediaDeviceInfo[]>([]),
    [passphrase, setPassphrase] = useState(""),
    [test, testing] = useState(false),
    [audioProblem, setAudioProblem] = useState("");
  const stop = useRef<(() => void) | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const load = () =>
      void devices()
        .then((d) => {
          if (alive) setList(d);
        })
        .catch((e) => {
          if (alive) setAudioProblem(audioError(e).message);
        });
    load();
    void startMicrophonePreview()
      .then(load)
      .catch((e) => {
        if (alive) setAudioProblem(audioError(e).message);
      });
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => {
      alive = false;
      mounted.current = false;
      navigator.mediaDevices.removeEventListener("devicechange", load);
      stop.current?.();
      stopMicrophonePreview();
    };
  }, []);
  const change = (p: Parameters<typeof s.saveSettings>[0]) => {
    s.saveSettings(p);
    setAudioProblem("");
    void refreshSettings(p).catch((e) =>
      setAudioProblem(audioError(e).message),
    );
  };
  return (
    <Modal
      title="Paramètres de Licra"
      className="settings-modal"
      onClose={onClose}
    >
      <nav className="settings-nav">
        {[
          ["audio", "Audio", "mic"],
          ["identity", "Identité", "shield"],
          ["application", "Application", "settings"],
        ].map(([id, label, icon]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} />
            {label}
          </button>
        ))}
      </nav>
      <section className="settings-body">
        {tab === "audio" && (
          <>
            <h3>Périphériques et transmission</h3>
            {audioProblem && <p role="alert">{audioProblem}</p>}
            <label>
              Niveau du microphone
              <div
                className="microphone-meter"
                role="meter"
                aria-label="Niveau du microphone"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(levelPercent)}
              >
                <span
                  className="microphone-fill"
                  style={{ width: `${levelPercent}%` }}
                />
                {s.settings.mode === "activation" && (
                  <span
                    className="microphone-threshold"
                    style={{ left: `${thresholdPercent}%` }}
                  />
                )}
              </div>
              <small>
                {s.settings.mode === "activation"
                  ? "La voix est transmise au-dessus du repère du seuil (hors mute)."
                  : "Parlez pour vérifier votre microphone."}
              </small>
            </label>
            {(["input", "output"] as const).map((kind) => (
              <label key={kind}>
                {kind === "input" ? "Microphone" : "Sortie audio"}
                <select
                  value={s.settings[kind]}
                  onChange={(e) => change({ [kind]: e.target.value })}
                >
                  <option value="">Par défaut</option>
                  {s.settings[kind] &&
                    !list.some((d) => d.deviceId === s.settings[kind]) && (
                      <option value={s.settings[kind]}>
                        Périphérique déconnecté — choisissez-en un autre
                      </option>
                    )}
                  {list
                    .filter(
                      (d) =>
                        d.kind ===
                        (kind === "input" ? "audioinput" : "audiooutput"),
                    )
                    .map((d, index) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label ||
                          `${kind === "input" ? "Microphone" : "Sortie audio"} ${index + 1}`}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            {(
              [
                "echoCancellation",
                "noiseSuppression",
                "autoGainControl",
              ] as const
            ).map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={s.settings[k]}
                  onChange={(e) => change({ [k]: e.target.checked })}
                />
                {
                  {
                    echoCancellation: "Annulation d’écho",
                    noiseSuppression: "Réduction du bruit",
                    autoGainControl: "Gain automatique",
                  }[k]
                }
              </label>
            ))}
            <label>
              Transmission
              <select
                value={s.settings.mode}
                onChange={(e) =>
                  change({ mode: e.target.value as typeof s.settings.mode })
                }
              >
                <option value="continuous">Continue</option>
                <option value="ptt">Push-to-talk global</option>
                <option value="activation">Activation vocale</option>
              </select>
            </label>
            {s.settings.mode === "ptt" && (
              <label>
                Raccourci
                <input
                  value={s.settings.shortcut}
                  onChange={(e) => s.saveSettings({ shortcut: e.target.value })}
                  onBlur={() => change({ shortcut: s.settings.shortcut })}
                />
              </label>
            )}
            {s.settings.mode === "activation" && (
              <label>
                Seuil d’activation · {Math.round(db(s.settings.threshold))} dB
                <small>Plus haut = moins sensible aux sons faibles.</small>
                <input
                  type="range"
                  min="-60"
                  max="0"
                  step="1"
                  value={db(s.settings.threshold)}
                  onChange={(e) =>
                    change({
                      threshold: Math.pow(10, Number(e.target.value) / 20),
                    })
                  }
                />
              </label>
            )}
            <button
              disabled={test}
              onClick={() => {
                testing(true);
                void testMicrophone()
                  .then((fn) => {
                    if (!mounted.current) {
                      fn();
                      return;
                    }
                    stop.current = fn;
                    setTimeout(() => {
                      fn();
                      if (mounted.current) testing(false);
                    }, 5000);
                  })
                  .catch((e) => {
                    testing(false);
                    setAudioProblem(audioError(e).message);
                  });
              }}
            >
              Test micro avec retour audio (5 s)
            </button>
          </>
        )}
        {tab === "application" && (
          <>
            <h3>Application et mises à jour</h3>
            <p>
              Les mises à jour officielles sont téléchargées depuis GitHub et
              vérifiées avec la signature Licra.
            </p>
            <button
              onClick={() => {
                onClose();
                window.dispatchEvent(new Event("licra:check-update"));
              }}
            >
              Vérifier les mises à jour
            </button>
            {s.status === "connected" &&
              s.server.bootstrap_available &&
              !s.permissions["server.edit"] && (
                <details>
                  <summary>Administration initiale du serveur</summary>
                  <p>
                    Réservé au propriétaire disposant du token généré sur le
                    serveur.
                  </p>
                  <button
                    onClick={async () => {
                      const token = await promptDialog(
                        "Token bootstrap administrateur",
                        "",
                        true,
                      );
                      if (token)
                        void request("CLAIM_OWNER", { token }).catch(report);
                    }}
                  >
                    Réclamer le rôle Owner
                  </button>
                </details>
              )}
          </>
        )}
        {tab === "identity" && (
          <>
            <h3>Identité chiffrée</h3>
            <p>
              Votre identité reste sur cet appareil. L’export chiffré permet de
              la sauvegarder ou de la transférer.
            </p>
            <label>
              Passphrase d’export/import
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
            <button
              onClick={() =>
                void invoke("identity_export", { passphrase })
                  .then(() => setPassphrase(""))
                  .catch(report)
              }
            >
              Exporter mon identité
            </button>
            <button
              disabled={s.status !== "disconnected"}
              onClick={async () => {
                if (
                  await confirmDialog(
                    "Remplacer l’identité locale ? Exportez-la d’abord.",
                  )
                )
                  void invoke("identity_import", { passphrase })
                    .then(() => setPassphrase(""))
                    .catch(report);
              }}
            >
              Importer une identité
            </button>
          </>
        )}
      </section>
    </Modal>
  );
}
