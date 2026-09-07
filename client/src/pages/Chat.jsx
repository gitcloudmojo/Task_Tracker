/**
 * Chat, on the same line as the approvals.
 *
 *   CEO  ⟷  manager  ⟷  each person
 *
 * A team member opens this and finds exactly one conversation: their manager.
 * The manager finds the CEO at the top and her team below. Nobody has to pick
 * a channel, because there is never more than one place a message could go.
 *
 * The list is generated from the hierarchy rather than from stored threads, so
 * a new joiner has somebody to talk to the moment they are added.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Layout from '../components/Layout.jsx';
import { Card, Empty, ErrorBanner, Badge, ClipIcon } from '../components/ui.jsx';
import FilePicker from '../components/FilePicker.jsx';
import { initialsOf, relativeTime, dateTimeLabel } from '../lib/format.js';
import { fileSize } from '../lib/task.js';

const ROLE_TONE = { ceo: 'accent', admin: 'warning', user: '' };

export default function Chat() {
  const { user } = useAuth();
  const { userId } = useParams();
  const navigate = useNavigate();
  const [threads, setThreads] = useState(null);
  const [rule, setRule] = useState('');
  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const [attaching, setAttaching] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  const loadThreads = () =>
    api
      .get('/chat/threads')
      .then((d) => {
        setThreads(d.threads);
        setRule(d.rule);
        // Open something rather than showing an empty pane: whatever is
        // waiting to be read, or the person at the top of the line.
        if (!userId && d.threads.length) {
          navigate(`/chat/${d.threads[0].partnerId}`, { replace: true });
        }
      })
      .catch(setError);

  useEffect(() => {
    loadThreads();
  }, []);

  useEffect(() => {
    if (!userId) {
      setThread(null);
      return;
    }
    api
      .get(`/chat/with/${userId}`)
      .then((d) => {
        setThread(d);
        setError(null);
        loadThreads();
      })
      .catch(setError);
  }, [userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread]);

  /**
   * Send, then attach. The message goes first so the thread updates instantly
   * even on a slow connection; the files follow against its id. A message with
   * nothing but a file is allowed — "here it is" is often the whole point.
   */
  const send = async () => {
    const body = draft.trim();
    if (!body && !files.length) return;
    setSending(true);
    try {
      const d = await api.post(`/chat/with/${userId}`, {
        body,
        willAttach: files.length > 0,
      });
      let message = d.message;
      if (files.length) {
        const withFiles = await api.upload(`/chat/messages/${message.id}/attachments`, files);
        message = withFiles.message;
      }
      setThread((t) => ({ ...t, messages: [...t.messages, message] }));
      setDraft('');
      setFiles([]);
      setAttaching(false);
      loadThreads();
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // A file dragged anywhere onto the thread is meant for the message box.
  const onDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    setFiles((f) => [...f, ...e.dataTransfer.files].slice(0, 5));
    setAttaching(true);
  };

  if (!threads) {
    return (
      <Layout title="Chat">
        <Empty>Loading…</Empty>
      </Layout>
    );
  }

  const only = threads.length === 1;

  return (
    <Layout title="Chat" subtitle={rule}>
      <div className={`chat${only ? ' single' : ''}`}>
        {!only && (
          <aside className="chat-list">
            {threads.map((t) => (
              <button
                key={t.partnerId}
                className={`chat-person${String(t.partnerId) === String(userId) ? ' active' : ''}`}
                onClick={() => navigate(`/chat/${t.partnerId}`)}
              >
                <span className="avatar sm">{initialsOf(t.name)}</span>
                <span className="chat-person-main">
                  <span className="chat-person-name">
                    <span className="ellipsis">{t.name}</span>
                    {t.unread > 0 && <span className="unread-count">{t.unread}</span>}
                  </span>
                  <span className="small muted">
                    {t.lastBody
                      ? `${t.lastFromMe ? 'You: ' : ''}${t.lastBody.slice(0, 46)}${t.lastBody.length > 46 ? '…' : ''}`
                      : t.relation}
                  </span>
                </span>
                {t.lastAt && <span className="chat-when">{relativeTime(t.lastAt)}</span>}
              </button>
            ))}
          </aside>
        )}

        <section className="chat-thread" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <ErrorBanner error={error} />
          {!thread ? (
            <Card>
              <Empty>Pick somebody on the left.</Empty>
            </Card>
          ) : (
            <>
              <div className="chat-head">
                <span className="avatar">{initialsOf(thread.partner.name)}</span>
                <div>
                  <div className="strong">{thread.partner.name}</div>
                  <div className="small muted">
                    {thread.partner.title || thread.partner.roleLabel}
                    {thread.partner.team ? ` · ${thread.partner.team}` : ''}
                  </div>
                </div>
                <div className="spacer" />
                <Badge tone={ROLE_TONE[thread.partner.role]}>{thread.partner.roleLabel}</Badge>
              </div>

              <div className="chat-scroll">
                {thread.messages.length === 0 ? (
                  <Empty>
                    Nothing here yet.{' '}
                    {thread.partner.role === 'admin'
                      ? 'Anything about your work goes here.'
                      : 'Say hello.'}
                  </Empty>
                ) : (
                  thread.messages.map((m, i) => {
                    const prev = thread.messages[i - 1];
                    const newDay =
                      !prev || String(prev.createdAt).slice(0, 10) !== String(m.createdAt).slice(0, 10);
                    return (
                      <div key={m.id}>
                        {newDay && (
                          <div className="chat-day">{dateTimeLabel(m.createdAt).split(',')[0]}</div>
                        )}
                        <div className={`bubble-row${m.mine ? ' mine' : ''}`}>
                          <div className="bubble">
                            {m.body && <div className="bubble-body">{m.body}</div>}

                            {m.files?.length > 0 && (
                              <div className="bubble-files">
                                {m.files.map((f) => (
                                  <button
                                    key={f.id}
                                    className="bubble-file"
                                    onClick={() =>
                                      api
                                        .download(`/chat/attachments/${f.id}`, f.filename)
                                        .catch(setError)
                                    }
                                    title={`Download ${f.filename}`}
                                  >
                                    <ClipIcon size={13} />
                                    <span className="bubble-file-name">{f.filename}</span>
                                    <span className="bubble-file-size">{fileSize(f.sizeBytes)}</span>
                                  </button>
                                ))}
                              </div>
                            )}

                            <div className="bubble-foot">
                              {m.mine ? 'You' : m.authorName} · {relativeTime(m.createdAt)}
                              {m.mine && m.readAt ? ' · read' : ''}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <div className="chat-composer">
                {(attaching || files.length > 0) && (
                  <div className="chat-attach">
                    <FilePicker
                      files={files}
                      onChange={setFiles}
                      label="Attach a file to this message"
                      compact
                    />
                  </div>
                )}
                <div className="chat-compose">
                  <button
                    className={`btn ghost clip${attaching || files.length ? ' on' : ''}`}
                    onClick={() => setAttaching((a) => !a)}
                    title="Attach a file"
                    aria-label="Attach a file"
                  >
                    <ClipIcon size={16} />
                  </button>
                  <textarea
                    rows={2}
                    value={draft}
                    placeholder={`Message ${thread.partner.name.split(' ')[0]}…`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                  />
                  <button
                    className="btn primary"
                    disabled={sending || (!draft.trim() && !files.length)}
                    onClick={send}
                  >
                    {sending ? 'Sending…' : files.length ? `Send · ${files.length}` : 'Send'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}
