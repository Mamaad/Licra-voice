import { useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import { useChat, loadChat } from "./chat";
import { request } from "./control";
import { youtubeAction, parseYouTubeID, useYouTube } from "./youtube";
import { ContextMenu } from "./ContextMenu";
import { confirmDialog } from "./Modal";
import { Avatar, Icon } from "./ui";
import type { ChatMessage } from "./types";
export function safeChatURL(value: string) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export async function openChatURL(value: string) {
  const url = safeChatURL(value);
  if (!url) throw new Error("Lien non autorisé");
  if ("__TAURI_INTERNALS__" in window) await invoke("open_external", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
export function MessageText({
  content,
  onError,
}: {
  content: string;
  onError: (e: unknown) => void;
}) {
  // React escapes every text fragment; no HTML or Markdown renderer is involved.
  return (
    <>
      {content.split(/(https?:\/\/[^\s<>]+)/gu).map((part, i) => {
        const url = safeChatURL(part);
        return url ? (
          <a
            key={i}
            href={url}
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              void openChatURL(url).catch(onError);
            }}
          >
            {part}
          </a>
        ) : (
          part
        );
      })}
    </>
  );
}
export function ChatPanel({
  channelId,
  peer,
  onClose,
}: {
  channelId?: string;
  peer?: { fingerprint: string; nickname: string };
  onClose?: () => void;
}) {
  const youtubeActivity = useYouTube((state) => state.activity);
  const s = useStore(),
    chat = useChat(),
    [thread, setThread] = useState(""),
    [before, setBefore] = useState(""),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(""),
    [reply, setReply] = useState<ChatMessage | null>(null),
    [editing, setEditing] = useState<ChatMessage | null>(null),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      message: ChatMessage;
    } | null>(null),
    [clock, setClock] = useState(Date.now());
  const list = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    typingAt = useRef(0),
    scrollBottom = useRef(true),
    loadingRef = useRef(false),
    generation = useRef(0),
    readMarker = useRef(""),
    sendingRef = useRef(false);
  const fp = s.users.find((u) => u.id === s.self_id)?.fingerprint ?? "",
    permission = channelId
      ? (s.channel_permissions[channelId] ?? {})
      : s.permissions;
  const canView =
      !!s.chat?.enabled && (!channelId || !!permission["chat.channel.view"]),
    canHistory = !channelId || !!permission["chat.channel.history"],
    canSend =
      !!permission[channelId ? "chat.channel.send" : "chat.private.send"];
  const messages = chat.messages[thread] ?? [],
    last = messages.at(-1)?.id;
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  useEffect(() => {
    const epoch = ++generation.current;
    setThread("");
    setDraft("");
    setReply(null);
    setEditing(null);
    setMenu(null);
    setError("");
    setMore(false);
    if (!canView) return;
    setLoading(true);
    loadingRef.current = true;
    void loadChat(
      channelId
        ? { channel_id: channelId }
        : { peer_fingerprint: peer!.fingerprint },
    )
      .then((page) => {
        if (epoch !== generation.current) return;
        setThread(page.thread_id);
        setBefore(page.before);
        setMore(page.has_more);
        scrollBottom.current = true;
      })
      .catch((e) => {
        if (epoch === generation.current) report(e);
      })
      .finally(() => {
        if (epoch === generation.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      });
    return () => {
      generation.current++;
    };
  }, [channelId, peer?.fingerprint, s.server.id, canView, canHistory]);
  useEffect(() => {
    if (scrollBottom.current)
      list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [thread, last]);
  useEffect(() => {
    if (!thread || !last || !s.chat?.history_enabled) return;
    const mark = () => {
      if (
        document.visibilityState === "visible" &&
        scrollBottom.current &&
        readMarker.current !== thread + ":" + last
      ) {
        readMarker.current = thread + ":" + last;
        void request("CHAT_READ", {
          thread_id: thread,
          message_id: last,
        }).catch((e) => {
          readMarker.current = "";
          report(e);
        });
      }
    };
    const timer = setTimeout(mark, 500);
    window.addEventListener("focus", mark);
    list.current?.addEventListener("scroll", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", mark);
      list.current?.removeEventListener("scroll", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [thread, last]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function older() {
    if (!more || loadingRef.current || !thread) return;
    loadingRef.current = true;
    setLoading(true);
    const epoch = generation.current;
    const el = list.current,
      anchor = el
        ? [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
            (m) => m.offsetTop + m.offsetHeight >= el.scrollTop,
          )
        : undefined,
      anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    try {
      const page = await loadChat(
        channelId
          ? { channel_id: channelId }
          : { peer_fingerprint: peer!.fingerprint },
        before,
        thread,
      );
      if (epoch !== generation.current) return;
      setBefore(page.before);
      setMore(page.has_more);
      requestAnimationFrame(() => {
        if (el && anchor?.isConnected)
          el.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
      });
    } catch (e) {
      report(e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }
  async function send() {
    if (!thread || !draft.trim() || !canSend || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const epoch = generation.current;
    setError("");
    try {
      await request(editing ? "CHAT_EDIT" : "CHAT_SEND", {
        thread_id: thread,
        message_id: editing?.id,
        content: draft,
        reply_to_message_id: reply?.id ?? null,
      });
      if (epoch !== generation.current) return;
      setDraft("");
      setEditing(null);
      setReply(null);
      scrollBottom.current = true;
      void request("CHAT_TYPING", { thread_id: thread, active: false }).catch(
        () => {},
      );
    } catch (e) {
      if (epoch === generation.current) report(e);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  function context(e: MouseEvent, m: ChatMessage) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, message: m });
  }
  const people = Object.values(chat.typing[thread] ?? {})
    .filter((u) => u.until > clock)
    .map((u) => u.nickname);
  return (
    <section
      className="chat-panel"
      aria-label={
        peer ? `Messages privés avec ${peer.nickname}` : "Chat du salon"
      }
    >
      <div className="members-heading">
        <h2>
          <Icon name="users" />
          {peer ? `MP · ${peer.nickname}` : "Chat du salon"}
        </h2>
        {onClose && (
          <button onClick={onClose} aria-label="Fermer les messages privés">
            Fermer
          </button>
        )}
      </div>
      {peer && (
        <small className="muted-text">
          Messages privés entre participants. Historique stocké sur ce serveur,
          sans chiffrement de bout en bout.
        </small>
      )}
      {!canView ? (
        <p>Chat indisponible ou permission refusée.</p>
      ) : (
        <>
          {!canHistory && (
            <small>
              Historique non autorisé. Les nouveaux messages restent visibles.
            </small>
          )}
          <div
            ref={list}
            className="chat-history"
            onScroll={() => {
              const el = list.current!;
              scrollBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              if (el.scrollTop < 30) void older();
            }}
          >
            {more && (
              <button disabled={loading} onClick={() => void older()}>
                Charger les messages précédents
              </button>
            )}
            {loading && <small>Chargement…</small>}
            {messages.map((m) => (
              <article
                className="chat-message"
                key={m.id}
                data-message-id={m.id}
                onContextMenu={(e) => context(e, m)}
              >
                <Avatar
                  name={m.author_nickname_snapshot}
                  identity={m.author_fingerprint}
                />
                <div>
                  <header>
                    <strong>{m.author_nickname_snapshot}</strong>
                    <time
                      dateTime={m.created_at}
                      title={new Date(m.created_at).toLocaleString()}
                    >
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    {m.edited_at && <small>modifié</small>}
                  </header>
                  {m.reply_to_message_id && (
                    <blockquote>
                      {m.reply
                        ? `${m.reply.nickname} · ${m.reply.deleted ? "Message supprimé" : m.reply.content.slice(0, 160)}`
                        : "Message cité indisponible"}
                    </blockquote>
                  )}
                  <p className={m.deleted_at ? "deleted-message" : ""}>
                    {m.deleted_at && !m.content ? (
                      "Message supprimé"
                    ) : (
                      <MessageText content={m.content} onError={report} />
                    )}
                  </p>
                  {channelId &&
                    !m.deleted_at &&
                    s.users.find((u) => u.id === s.self_id)?.channel_id ===
                      channelId &&
                    s.youtube?.enabled &&
                    (s.channel_permissions[channelId]?.[
                      "youtube.change_video"
                    ] ||
                      ((!youtubeActivity?.video_id ||
                        youtubeActivity.state === "STOPPED") &&
                        s.channel_permissions[channelId]?.["youtube.start"])) &&
                    [...m.content.matchAll(/https?:\/\/[^\s<>]+/gu)]
                      .map((match) => parseYouTubeID(match[0]))
                      .filter(
                        (id, index, all) => id && all.indexOf(id) === index,
                      )
                      .map((id) => (
                        <button
                          key={id}
                          className="chat-youtube-action"
                          onClick={() => {
                            useYouTube.setState({ preferred: "youtube" });
                            void youtubeAction("YOUTUBE_START", {
                              video: id,
                            }).catch(report);
                          }}
                        >
                          Regarder ensemble
                        </button>
                      ))}
                  {m.deleted_at && m.content && (
                    <small>Supprimé · visible pour la modération</small>
                  )}
                </div>
              </article>
            ))}
            {!loading && !messages.length && (
              <p className="muted-text">
                Aucun message. Commencez la discussion.
              </p>
            )}
          </div>
          <small className="typing-indicator" aria-live="polite">
            {people.length ? `${people.join(", ")} écrit…` : " "}
          </small>
          {(reply || editing) && (
            <div className="chat-reply">
              {editing
                ? "Modifier votre message"
                : `Réponse à ${reply?.author_nickname_snapshot} : ${reply?.content.slice(0, 100)}`}
              <button
                onClick={() => {
                  setReply(null);
                  if (editing) setDraft("");
                  setEditing(null);
                }}
              >
                Annuler
              </button>
            </div>
          )}
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={input}
              aria-label={peer ? "Message privé" : "Message au salon"}
              placeholder="Écrire un message…"
              maxLength={s.chat?.max_message_length ?? 4000}
              disabled={!canSend || !thread || sending}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (thread && Date.now() - typingAt.current > 3000) {
                  typingAt.current = Date.now();
                  void request("CHAT_TYPING", {
                    thread_id: thread,
                    active: true,
                  }).catch(() => {});
                }
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="primary"
              disabled={!canSend || !draft.trim() || !thread || sending}
            >
              Envoyer
            </button>
          </form>
          {!canSend && (
            <small>Envoi non autorisé dans cette conversation.</small>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="danger-text">
          {error}
        </p>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(menu.message.content)
                .catch(report);
              setMenu(null);
            }}
          >
            Copier
          </button>
          {!menu.message.deleted_at && canSend && (
            <button
              onClick={() => {
                setReply(menu.message);
                setEditing(null);
                setMenu(null);
                input.current?.focus();
              }}
            >
              Répondre
            </button>
          )}
          {!menu.message.deleted_at &&
            menu.message.author_fingerprint === fp &&
            (peer || permission["chat.channel.edit_own"]) && (
              <button
                onClick={() => {
                  setDraft(menu.message.content);
                  setEditing(menu.message);
                  setReply(null);
                  setMenu(null);
                  input.current?.focus();
                }}
              >
                Modifier
              </button>
            )}
          {!menu.message.deleted_at &&
            ((menu.message.author_fingerprint === fp &&
              (peer || permission["chat.channel.delete_own"])) ||
              (!peer && permission["chat.channel.delete_others"])) && (
              <button
                className="danger-text"
                onClick={() => {
                  const message = menu.message;
                  setMenu(null);
                  void confirmDialog("Supprimer ce message ?")
                    .then((ok) =>
                      ok
                        ? request("CHAT_DELETE", {
                            thread_id: thread,
                            message_id: message.id,
                          })
                        : null,
                    )
                    .catch(report);
                }}
              >
                Supprimer
              </button>
            )}
        </ContextMenu>
      )}
    </section>
  );
}
export function PrivateInbox() {
  const chat = useChat();
  const threads = chat.threads.filter((t) => !t.channel_id);
  if (!threads.length) return null;
  return (
    <section className="private-inbox">
      <h3>Messages privés</h3>
      {threads.map((t) => (
        <button
          key={t.id}
          onClick={() =>
            chat.set({
              privatePeer: {
                fingerprint: t.peer_fingerprint,
                nickname: t.peer_nickname,
              },
            })
          }
        >
          {t.peer_nickname}
          {t.unread > 0 && <span className="unread-badge">{t.unread}</span>}
        </button>
      ))}
    </section>
  );
}
