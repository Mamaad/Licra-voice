import { create } from "zustand";
import { request } from "./control";
import type { ChatMessage } from "./types";
export type ChatThread = {
  id: string;
  channel_id: string | null;
  peer_fingerprint: string;
  peer_nickname: string;
  last_id: string;
  unread: number;
};
type Page = {
  thread_id: string;
  messages: ChatMessage[];
  before: string;
  has_more: boolean;
};
type State = {
  threads: ChatThread[];
  messages: Record<string, ChatMessage[]>;
  typing: Record<string, Record<string, { nickname: string; until: number }>>;
  privatePeer: { fingerprint: string; nickname: string } | null;
  set: (p: Partial<State>) => void;
};
export const useChat = create<State>((set) => ({
  threads: [],
  messages: {},
  typing: {},
  privatePeer: null,
  set,
}));
export function openPrivate(fingerprint: string, nickname: string) {
  useChat.getState().set({ privatePeer: { fingerprint, nickname } });
}
export function applyChatEvent(type: string, p: any) {
  const s = useChat.getState();
  if (type === "SNAPSHOT") {
    s.set({ threads: [], messages: {}, typing: {}, privatePeer: null });
    return;
  }
  if (type === "CHAT_UNREAD") {
    s.set({
      threads: p.partial
        ? [
            ...s.threads.filter(
              (t) => !p.threads.some((u: ChatThread) => u.id === t.id),
            ),
            ...p.threads,
          ]
        : p.threads,
    });
    return;
  }
  if (type === "TYPING_STARTED" || type === "TYPING_STOPPED") {
    if (!s.messages[p.thread_id]) return;
    const people = Object.fromEntries(
      Object.entries(s.typing[p.thread_id] ?? {}).filter(
        ([, u]) => u.until > Date.now(),
      ),
    );
    if (type === "TYPING_STOPPED") delete people[p.fingerprint];
    else
      people[p.fingerprint] = {
        nickname: p.nickname,
        until: Date.now() + 6000,
      };
    s.set({ typing: { ...s.typing, [p.thread_id]: people } });
    return;
  }
  if (!/^(CHAT|PRIVATE)_MESSAGE_(CREATED|EDITED|DELETED)$/.test(type)) return;
  const old = s.messages[p.thread_id];
  if (!old) return;
  const next = old
    .filter((m) => m.id !== p.id)
    .map((m) =>
      m.reply_to_message_id === p.id
        ? {
            ...m,
            reply: {
              id: p.id,
              nickname: p.author_nickname_snapshot,
              content: p.content,
              deleted: !!p.deleted_at,
            },
          }
        : m,
    );
  next.push(p);
  next.sort((a, b) => Number(a.id) - Number(b.id));
  s.set({ messages: { ...s.messages, [p.thread_id]: next.slice(-1000) } });
}
export async function loadChat(
  target: { channel_id: string } | { peer_fingerprint: string },
  before?: string,
  threadId?: string,
): Promise<Page> {
  const page: Page = await request(
    before ? "CHAT_HISTORY" : "CHAT_OPEN",
    before ? { thread_id: threadId, before } : target,
  );
  const s = useChat.getState(),
    live = s.messages[page.thread_id] ?? [];
  // Keep live events received during history loading; cap the client cache at 1000 messages.
  const byID = new Map([...page.messages, ...live].map((m) => [m.id, m]));
  const cache = { ...s.messages };
  if (!cache[page.thread_id] && Object.keys(cache).length >= 10)
    delete cache[Object.keys(cache)[0]];
  const messages = [...byID.values()].sort(
    (a, b) => Number(a.id) - Number(b.id),
  );
  s.set({
    typing: Object.fromEntries(
      Object.entries(s.typing).filter(
        ([id]) => id in cache || id === page.thread_id,
      ),
    ),
    messages: {
      ...cache,
      [page.thread_id]: before
        ? messages.slice(0, 1000)
        : messages.slice(-1000),
    },
  });
  return page;
}
