import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import { devices, refreshSettings, testMicrophone } from "./voice";
import { report } from "./control";
import { Modal } from "./Modal";
export function Settings({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [list, setList] = useState<MediaDeviceInfo[]>([]),
    [passphrase, setPassphrase] = useState(""),
    [test, testing] = useState(false);
  const stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    void devices().then(setList).catch(report);
    return () => {
      stop.current?.();
    };
  }, []);
  const change = (p: Parameters<typeof s.saveSettings>[0]) => {
    s.saveSettings(p);
    void refreshSettings().catch(report);
  };
  return (
    <Modal title="Audio et identité" onClose={onClose}>
      {(["input", "output"] as const).map((kind) => (
        <label key={kind}>
          {kind === "input" ? "Microphone" : "Sortie audio"}
          <select
            value={s.settings[kind]}
            onChange={(e) => change({ [kind]: e.target.value })}
          >
            <option value="">Par défaut</option>
            {list
              .filter(
                (d) =>
                  d.kind === (kind === "input" ? "audioinput" : "audiooutput"),
              )
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
          </select>
        </label>
      ))}
      {(
        ["echoCancellation", "noiseSuppression", "autoGainControl"] as const
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
            onBlur={() => void refreshSettings().catch(report)}
          />
        </label>
      )}
      {s.settings.mode === "activation" && (
        <label>
          Seuil de voix
          <input
            type="range"
            min="0.005"
            max="0.15"
            step="0.005"
            value={s.settings.threshold}
            onChange={(e) => change({ threshold: Number(e.target.value) })}
          />
        </label>
      )}
      <button
        disabled={test}
        onClick={() => {
          testing(true);
          void testMicrophone()
            .then((fn) => {
              stop.current = fn;
              setTimeout(() => {
                fn();
                testing(false);
              }, 5000);
            })
            .catch((e) => {
              testing(false);
              report(e);
            });
        }}
      >
        Test micro avec retour audio (5 s)
      </button>
      <button
        onClick={() => window.dispatchEvent(new Event("licra:check-update"))}
      >
        Vérifier les mises à jour
      </button>
      <h3>Identité chiffrée</h3>
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
        onClick={() => {
          if (confirm("Remplacer l’identité locale ? Exportez-la d’abord."))
            void invoke("identity_import", { passphrase })
              .then(() => setPassphrase(""))
              .catch(report);
        }}
      >
        Importer une identité
      </button>
    </Modal>
  );
}
