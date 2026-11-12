import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, type ChatMessage, type ConversationSummary } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { Avatar } from '../components/Avatar';
import { ReportButton } from '../components/ReportButton';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** FR10: private conversations. Only the two people in one can open it; messages are stored encrypted. */
export function Messages() {
  const { id } = useParams();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState('');

  const loadList = useCallback(() => {
    api<{ items: ConversationSummary[] }>('/messaging/conversations')
      .then((res) => setConversations(res.items))
      .catch((err) => setError(errorText(err, 'Could not load your conversations.')));
  }, []);
  useEffect(loadList, [loadList, id]);

  return (
    <main className="page stack">
      <header className="page-header">
        <h1>Messages</h1>
        <p className="muted">Private conversations open when a contact request is accepted. Emails are never shown.</p>
      </header>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="chat-layout">
        <nav className="card chat-list" aria-label="Conversations">
          {conversations === null && <p className="muted chat-empty">Loading…</p>}
          {conversations?.length === 0 && (
            <p className="muted chat-empty">
              No conversations yet. Accept a request on <Link to="/requests">Requests</Link>, or contact a project team.
            </p>
          )}
          {conversations?.map((c) => (
            <Link key={c.id} to={`/messages/${c.id}`} className={`chat-item${c.id === id ? ' active' : ''}`} aria-current={c.id === id ? 'page' : undefined}>
              <Avatar name={c.with?.name ?? '?'} size={36} />
              <span className="chat-item-main">
                <strong>{c.with?.name ?? 'Former member'}</strong>
                <span className="muted small">{c.lastMessage ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.preview}` : (c.project?.title ?? 'No messages yet')}</span>
              </span>
            </Link>
          ))}
        </nav>
        {id ? (
          <Thread key={id} id={id} canSend={user?.status === 'ACTIVE' && user.role !== 'ADMIN'} onSent={loadList} />
        ) : (
          <section className="card chat-thread chat-placeholder">
            <p className="muted">Choose a conversation to read it.</p>
          </section>
        )}
      </div>
    </main>
  );
}

function Thread({ id, canSend, onSent }: { id: string; canSend: boolean; onSent: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [other, setOther] = useState<{ id: string; name: string } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  // The server sends newest first; the thread shows oldest first.
  const load = useCallback(
    async (cursor?: string) => {
      try {
        const res = await api<{ with: { id: string; name: string } | null; items: ChatMessage[]; nextCursor: string | null }>(
          `/messaging/conversations/${encodeURIComponent(id)}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        const page = [...res.items].reverse();
        setMessages((list) => (cursor ? [...page, ...list] : page));
        setOther(res.with);
        setNextCursor(res.nextCursor);
        setState('ready');
        if (!cursor) setTimeout(() => bottom.current?.scrollIntoView({ block: 'end' }), 0);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) setState('missing');
        else setError(errorText(err, 'Could not load messages.'));
      }
    },
    [id],
  );

  useEffect(() => {
    load();
    // New messages arrive by polling; only the first page is refreshed.
    const timer = window.setInterval(() => {
      api<{ items: ChatMessage[] }>(`/messaging/conversations/${encodeURIComponent(id)}/messages`)
        .then((res) => setMessages((list) => {
          const known = new Set(list.map((m) => m.id));
          const fresh = res.items.filter((m) => !known.has(m.id)).reverse();
          return fresh.length ? [...list, ...fresh] : list;
        }))
        .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [id, load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await api<{ message: ChatMessage }>(`/messaging/conversations/${encodeURIComponent(id)}/messages`, { body: { body: draft } });
      setMessages((list) => [...list, res.message]);
      setDraft('');
      onSent();
      setTimeout(() => bottom.current?.scrollIntoView({ block: 'end' }), 0);
    } catch (err) {
      setError(errorText(err, 'Could not send the message.'));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'missing') {
    return (
      <section className="card chat-thread chat-placeholder">
        <p className="muted">This conversation is not available.</p>
      </section>
    );
  }

  return (
    <section className="card chat-thread" aria-label={other ? `Conversation with ${other.name}` : 'Conversation'}>
      <header className="chat-head row space-between">
        <strong>{other?.name ?? '…'}</strong>
        <ReportButton targetType="CONVERSATION" targetId={id} label="Report conversation" />
      </header>
      <div className="chat-messages">
        {nextCursor && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(nextCursor)} style={{ alignSelf: 'center' }}>
            Load older messages
          </button>
        )}
        {state === 'loading' && <p className="muted">Loading…</p>}
        {state === 'ready' && messages.length === 0 && <p className="muted">No messages yet. Say hello.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`bubble${m.mine ? ' bubble-mine' : ''}`}>
            <p>{m.body ?? <em>This message cannot be shown.</em>}</p>
            <time className="small" dateTime={m.createdAt}>
              {new Date(m.createdAt).toLocaleString()}
            </time>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {canSend ? (
        <form className="chat-form" onSubmit={send}>
          <label className="sr-only" htmlFor="chat-draft">
            Message
          </label>
          <textarea id="chat-draft" className="input textarea" rows={2} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message" disabled={busy} />
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
            Send
          </button>
        </form>
      ) : (
        <p className="muted small chat-form">Your account cannot send messages right now.</p>
      )}
    </section>
  );
}
