import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./ui";
import { useStore } from "./store";
export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const error = useStore((s) => s.error);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <IconButton icon="close" label="Fermer" onClick={onClose} />
      </div>
      {error && (
        <div className="modal-error" role="alert">
          <span>{error}</span>
          <IconButton
            icon="close"
            label="Fermer le message"
            onClick={() => useStore.getState().set({ error: "" })}
          />
        </div>
      )}
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
type Question = {
  title: string;
  message?: string;
  value?: string;
  input?: boolean;
  password?: boolean;
  danger?: boolean;
  confirm?: string;
  resolve: (value: string | null) => void;
};
function ask(question: Omit<Question, "resolve">) {
  return new Promise<string | null>((resolve) =>
    window.dispatchEvent(
      new CustomEvent("licra:dialog", { detail: { ...question, resolve } }),
    ),
  );
}
export const promptDialog = (title: string, value = "", password = false) =>
  ask({ title, value, input: true, password, confirm: "Valider" });
export const confirmDialog = async (message: string) =>
  (await ask({
    title: "Confirmer l’action",
    message,
    danger: /Supprimer|Bannir|Expulser|Arrêter|Remplacer/.test(message),
    confirm: "Confirmer",
  })) !== null;
export function ActionDialog() {
  const [question, setQuestion] = useState<Question | null>(null),
    [value, setValue] = useState("");
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<Question>).detail;
      setQuestion((previous) => {
        previous?.resolve(null);
        return next;
      });
      setValue(next.value ?? "");
    };
    window.addEventListener("licra:dialog", handler);
    return () => window.removeEventListener("licra:dialog", handler);
  }, []);
  function finish(value: string | null) {
    question?.resolve(value);
    setQuestion(null);
  }
  return question ? (
    <Modal title={question.title} onClose={() => finish(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          finish(value);
        }}
      >
        {question.message && <p>{question.message}</p>}
        {question.input && (
          <label>
            {question.title}
            <input
              autoFocus
              type={question.password ? "password" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => finish(null)}>
            Annuler
          </button>
          <button className={question.danger ? "danger" : "primary"}>
            {question.confirm}
          </button>
        </div>
      </form>
    </Modal>
  ) : null;
}
