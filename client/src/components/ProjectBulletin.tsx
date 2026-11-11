import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, MILESTONE_LABELS, MILESTONE_STATUSES, STAGE_LABELS, STAGES, type MilestoneStatus, type Workspace } from '../api';

interface Milestone {
  id: string;
  title: string;
  status: MilestoneStatus;
  dueDate: string | null;
}
interface Props {
  title: string;
  stage: string;
  milestones: Milestone[];
  progress: Array<{ id: string; body: string; createdAt: string }>;
  completion?: number | null;
}

const ORDER: MilestoneStatus[] = ['DONE', 'IN_PROGRESS', 'PLANNED'];
const COLOR: Record<MilestoneStatus, string> = { DONE: 'var(--success)', IN_PROGRESS: '#e0a23b', PLANNED: 'var(--border-strong)' };

const point = (fraction: number, r: number) => {
  const angle = fraction * 2 * Math.PI;
  return `${(100 + r * Math.sin(angle)).toFixed(2)},${(100 - r * Math.cos(angle)).toFixed(2)}`;
};

/** Used when the team has set no percentage and there are no milestones yet. */
const STAGE_PERCENT: Record<string, number> = { IDEA: 10, PROTOTYPE: 35, MVP: 60, PILOT: 80, LAUNCHED: 100 };

type Source = 'team' | 'milestones' | 'stage';
interface Accomplished {
  percent: number;
  source: Source;
}

/** The team's own figure wins; otherwise milestones done; otherwise an estimate from the stage. */
function accomplishedOf(completion: number | null | undefined, counts: Record<MilestoneStatus, number>, total: number, stage: string): Accomplished {
  if (completion !== null && completion !== undefined) return { percent: completion, source: 'team' };
  if (total > 0) return { percent: Math.round((counts.DONE / total) * 100), source: 'milestones' };
  return { percent: STAGE_PERCENT[stage] ?? 0, source: 'stage' };
}

/**
 * The accomplished chart. With milestones as the source it splits them by status; otherwise it is
 * done against remaining. Every slice is also named in the legend, so colour is never the only cue.
 */
function AccomplishedChart({ value, counts, total, size }: { value: Accomplished; counts: Record<MilestoneStatus, number>; total: number; size: number }) {
  const slices =
    value.source === 'milestones'
      ? ORDER.filter((s) => counts[s] > 0).map((s) => ({ key: s, share: counts[s] / total, color: COLOR[s] }))
      : [
          { key: 'done', share: value.percent / 100, color: COLOR.DONE },
          { key: 'left', share: 1 - value.percent / 100, color: COLOR.PLANNED },
        ].filter((x) => x.share > 0);
  let start = 0;
  const arcs = slices.map((x) => {
    const from = start;
    start += x.share;
    return { ...x, from, to: start };
  });
  return (
    <div className="bulletin-pie" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={`${value.percent}% accomplished`}>
        {arcs.map(({ key, from, to, color }) =>
          to - from >= 0.9999 ? (
            <circle key={key} cx="100" cy="100" r="90" fill={color} />
          ) : (
            <path key={key} d={`M100,100 L${point(from, 90)} A90,90 0 ${to - from > 0.5 ? 1 : 0} 1 ${point(to, 90)} Z`} fill={color} stroke="var(--surface)" strokeWidth="2" />
          ),
        )}
        <circle cx="100" cy="100" r="52" fill="var(--surface)" />
      </svg>
      <div className="bulletin-pie-center">
        <strong>{value.percent}%</strong>
        <span>done</span>
      </div>
    </div>
  );
}

function Legend({ value, counts }: { value: Accomplished; counts: Record<MilestoneStatus, number> }) {
  const rows =
    value.source === 'milestones'
      ? ORDER.map((s) => ({ key: s, color: COLOR[s], label: MILESTONE_LABELS[s], amount: String(counts[s]) }))
      : [
          { key: 'done', color: COLOR.DONE, label: 'Done', amount: `${value.percent}%` },
          { key: 'left', color: COLOR.PLANNED, label: 'Still to do', amount: `${100 - value.percent}%` },
        ];
  return (
    <ul className="bulletin-legend">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="bulletin-swatch" style={{ background: r.color }} aria-hidden="true" />
          <span>{r.label}</span>
          <strong>{r.amount}</strong>
        </li>
      ))}
    </ul>
  );
}

function sourceNote(value: Accomplished, total: number, stage: string): string {
  if (value.source === 'team') return 'Set by the project team';
  if (value.source === 'milestones') return `From ${total} ${total === 1 ? 'milestone' : 'milestones'}`;
  return `Estimated from the ${STAGE_LABELS[stage] ?? stage} stage`;
}

/** The team sets "how much is done" with a slider; the chart previews it while dragging. */
function CompletionControl({ value, draft, setDraft, busy, onSave, onAuto }: { value: Accomplished; draft: number; setDraft: (n: number) => void; busy: boolean; onSave: () => void; onAuto: () => void }) {
  return (
    <div className="completion-edit">
      <label htmlFor="completion-range">
        How much of the project is done? <strong>{draft}%</strong>
      </label>
      <input id="completion-range" type="range" min={0} max={100} step={5} value={draft} onChange={(e) => setDraft(Number(e.target.value))} disabled={busy} />
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={busy || (value.source === 'team' && value.percent === draft)}>
          Save {draft}%
        </button>
        {value.source === 'team' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAuto} disabled={busy}>
            Work it out automatically
          </button>
        )}
      </div>
    </div>
  );
}

/** Where the project is on the path from idea to launch. */
function StageTrack({ stage, onPick, busy }: { stage: string; onPick?: (stage: string) => void; busy?: boolean }) {
  const current = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <ol className={`stage-track${onPick ? ' editable' : ''}`} aria-label={`Development stage: ${STAGE_LABELS[stage] ?? stage}`}>
      {STAGES.map((s, i) => {
        const inner = (
          <>
            <span className="stage-dot" aria-hidden="true">
              {i < current ? '✓' : i + 1}
            </span>
            <span className="stage-name">{STAGE_LABELS[s]}</span>
          </>
        );
        return (
          <li key={s} className={i < current ? 'past' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>
            {onPick ? (
              <button type="button" className="stage-pick" onClick={() => onPick(s)} disabled={busy || i === current} aria-label={`Set stage to ${STAGE_LABELS[s]}`}>
                {inner}
              </button>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface RowEdits {
  busy: boolean;
  onStatus: (id: string, status: MilestoneStatus) => void;
  onDelete: (id: string) => void;
}

function MilestoneRows({ milestones, edits }: { milestones: Milestone[]; edits?: RowEdits }) {
  if (milestones.length === 0) return <p className="muted">No milestones have been added yet.</p>;
  return (
    <ol className="milestone-list">
      {milestones.map((m) => (
        <li key={m.id} className={`milestone milestone-${m.status.toLowerCase()}`}>
          <span className="milestone-dot" aria-hidden="true" />
          <span className="milestone-title">{m.title}</span>
          {edits ? (
            <select className="input milestone-status" value={m.status} disabled={edits.busy} onChange={(e) => edits.onStatus(m.id, e.target.value as MilestoneStatus)} aria-label={`Status of ${m.title}`}>
              {MILESTONE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {MILESTONE_LABELS[st]}
                </option>
              ))}
            </select>
          ) : (
            <span className={`badge ${m.status === 'DONE' ? 'badge-success' : m.status === 'IN_PROGRESS' ? 'badge-accent' : ''}`}>{MILESTONE_LABELS[m.status]}</span>
          )}
          {m.dueDate && <span className="muted small">due {new Date(m.dueDate).toLocaleDateString()}</span>}
          {edits && (
            <button type="button" className="btn btn-ghost btn-sm danger-text" disabled={edits.busy} onClick={() => edits.onDelete(m.id)} aria-label={`Delete ${m.title}`}>
              Delete
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Adds one milestone; the bulletin reloads afterwards. */
function AddMilestone({ busy, onAdd }: { busy: boolean; onAdd: (input: { title: string; status: MilestoneStatus; dueDate: string }) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<MilestoneStatus>('PLANNED');
  const [dueDate, setDueDate] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (await onAdd({ title: title.trim(), status, dueDate })) {
      setTitle('');
      setDueDate('');
      setStatus('PLANNED');
    }
  }
  return (
    <form className="add-milestone" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="new-milestone-title">
        Milestone title
      </label>
      <input id="new-milestone-title" className="input" placeholder="New milestone, e.g. Export to PDF" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      <label className="visually-hidden" htmlFor="new-milestone-status">
        Status
      </label>
      <select id="new-milestone-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as MilestoneStatus)} disabled={busy}>
        {MILESTONE_STATUSES.map((st) => (
          <option key={st} value={st}>
            {MILESTONE_LABELS[st]}
          </option>
        ))}
      </select>
      <label className="visually-hidden" htmlFor="new-milestone-due">
        Due date (optional)
      </label>
      <input id="new-milestone-due" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>
        Add
      </button>
    </form>
  );
}

/**
 * The project's bulletin: development stage, a pie chart of milestones accomplished, and the
 * milestones themselves, with a full-screen Present mode. It draws only on what the server
 * sent for this viewer: Guests get no milestones, so they see the development stage alone.
 */
export function ProjectBulletin({
  title,
  stage,
  milestones,
  progress,
  projectId,
  editable = false,
  completion,
}: Omit<Props, 'milestones' | 'progress'> & { milestones?: Milestone[]; progress?: Props['progress']; projectId?: string; editable?: boolean }) {
  if (!milestones) return <StageOnly stage={stage} />;
  return <FullBulletin title={title} stage={stage} milestones={milestones} progress={progress ?? []} completion={completion} projectId={editable ? projectId : undefined} />;
}

function StageOnly({ stage }: { stage: string }) {
  return (
    <section className="card card-pad stack" aria-labelledby="bulletin-title">
      <h2 id="bulletin-title">Project bulletin</h2>
      <div>
        <h3 className="bulletin-label">Development state</h3>
        <StageTrack stage={stage} />
      </div>
      <p className="locked-note">
        <span aria-hidden="true">🔒</span> <Link to="/login">Sign in</Link> to see the milestones and how much is accomplished.
      </p>
    </section>
  );
}

/**
 * The team edits the bulletin in place: the stage and every milestone are saved as they change
 * (the stage applies at once on a live project, like in the editor), and the chart follows.
 */
function FullBulletin({ title, stage: initialStage, milestones: initialMilestones, progress, completion: initialCompletion, projectId }: Props & { projectId?: string }) {
  const [presenting, setPresenting] = useState(false);
  const [stage, setStage] = useState(initialStage);
  const [milestones, setMilestones] = useState(initialMilestones);
  const [completion, setCompletion] = useState(initialCompletion ?? null);
  const [draft, setDraft] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setStage(initialStage), [initialStage]);
  useEffect(() => setMilestones(initialMilestones), [initialMilestones]);
  useEffect(() => setCompletion(initialCompletion ?? null), [initialCompletion]);

  /** Runs one change, then reloads the team's own copy so the chart shows what was saved. */
  async function change(run: () => Promise<unknown>): Promise<boolean> {
    if (!projectId) return false;
    setBusy(true);
    setError('');
    try {
      await run();
      const ws = await api<Workspace>(`/projects/${projectId}/workspace`);
      setStage(ws.project.stage);
      setMilestones(ws.milestones);
      setCompletion(ws.project.completion);
      setDraft(null);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the change.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const pickStage = (next: string) => change(() => api(`/projects/${projectId}`, { method: 'PATCH', body: { stage: next } }));
  const edits: RowEdits = {
    busy,
    onStatus: (id, status) => void change(() => api(`/projects/${projectId}/milestones/${id}`, { method: 'PATCH', body: { status } })),
    onDelete: (id) => void change(() => api(`/projects/${projectId}/milestones/${id}`, { method: 'DELETE' })),
  };
  const saveCompletion = (value: number | null) => change(() => api(`/projects/${projectId}`, { method: 'PATCH', body: { completion: value } }));
  const addMilestone = (input: { title: string; status: MilestoneStatus; dueDate: string }) =>
    change(() => api(`/projects/${projectId}/milestones`, { body: { title: input.title, status: input.status, dueDate: input.dueDate || null } }));
  const counts = { DONE: 0, IN_PROGRESS: 0, PLANNED: 0 } as Record<MilestoneStatus, number>;
  for (const m of milestones) counts[m.status] += 1;
  const total = milestones.length;
  const next = milestones.find((m) => m.status === 'IN_PROGRESS') ?? milestones.find((m) => m.status === 'PLANNED');
  const saved = accomplishedOf(completion, counts, total, stage);
  // While the team drags the slider, the chart shows the value they are about to save.
  const shown: Accomplished = editing && draft !== null ? { percent: draft, source: 'team' } : saved;

  return (
    <section className="card card-pad stack" aria-labelledby="bulletin-title">
      <div className="row space-between">
        <h2 id="bulletin-title">Project bulletin</h2>
        <div className="row">
          {projectId && (
            <button type="button" className={`btn btn-sm ${editing ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEditing(!editing)} aria-pressed={editing}>
              {editing ? '✓ Done editing' : '✎ Edit bulletin'}
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPresenting(true)}>
            ▶ Present
          </button>
        </div>
      </div>
      {editing && <p className="muted small bulletin-hint">You are editing your project’s bulletin. Click a stage to set it, change each milestone’s status, or add new ones. Changes are saved and shown to viewers at once.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div>
        <h3 className="bulletin-label">Development state</h3>
        <StageTrack stage={stage} onPick={editing ? pickStage : undefined} busy={busy} />
      </div>
      <div className="bulletin-body">
        <div className="bulletin-chart">
          <h3 className="bulletin-label">Accomplished</h3>
          <div className="row">
            <AccomplishedChart value={shown} counts={counts} total={total} size={150} />
            <Legend value={shown} counts={counts} />
          </div>
          <p className="muted small bulletin-source">{sourceNote(shown, total, stage)}</p>
          {editing && <CompletionControl value={saved} draft={draft ?? saved.percent} setDraft={setDraft} busy={busy} onSave={() => void saveCompletion(draft ?? saved.percent)} onAuto={() => void saveCompletion(null)} />}
        </div>
        <div className="bulletin-facts">
          <h3 className="bulletin-label">Milestones</h3>
          {total === 0 ? (
            <p className="muted">{projectId && !editing ? 'No milestones yet. Click “Edit bulletin” to add your first one.' : 'No milestones have been added yet.'}</p>
          ) : (
            <p>
              <strong>
                {counts.DONE} of {total}
              </strong>{' '}
              {total === 1 ? 'milestone' : 'milestones'} done
            </p>
          )}
          {next && (
            <p className="muted">
              {next.status === 'IN_PROGRESS' ? 'Now' : 'Next'}: {next.title}
              {next.dueDate ? ` (due ${new Date(next.dueDate).toLocaleDateString()})` : ''}
            </p>
          )}
          {progress[0] && (
            <p className="muted small">Last update {new Date(progress[0].createdAt).toLocaleDateString()}</p>
          )}
        </div>
      </div>
      {(total > 0 || editing) && (
        <div className="stack">
          <h3 className="bulletin-label">Timeline</h3>
          {total > 0 && <MilestoneRows milestones={milestones} edits={editing ? edits : undefined} />}
          {editing && <AddMilestone busy={busy} onAdd={addMilestone} />}
        </div>
      )}
      {presenting && <BulletinPresentation title={title} stage={stage} milestones={milestones} progress={progress} counts={counts} accomplished={saved} onClose={() => setPresenting(false)} />}
    </section>
  );
}

function BulletinPresentation({ title, stage, milestones, progress, counts, accomplished, onClose }: Props & { counts: Record<MilestoneStatus, number>; accomplished: Accomplished; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const total = milestones.length;

  const slides = [
    {
      name: 'Development state',
      body: (
        <>
          <p className="deck-lead">
            Currently at the <strong>{STAGE_LABELS[stage] ?? stage}</strong> stage.
          </p>
          <StageTrack stage={stage} />
        </>
      ),
    },
    {
      name: 'Accomplished',
      body: (
        <div className="deck-chart">
          <AccomplishedChart value={accomplished} counts={counts} total={total} size={300} />
          <div className="stack">
            <p className="deck-lead">
              {total === 0 ? (
                'No milestones have been added yet.'
              ) : (
                <>
                  <strong>
                    {counts.DONE} of {total}
                  </strong>{' '}
                  {total === 1 ? 'milestone' : 'milestones'} done
                </>
              )}
            </p>
            <Legend value={accomplished} counts={counts} />
            <p className="muted">{sourceNote(accomplished, total, stage)}</p>
          </div>
        </div>
      ),
    },
    { name: 'Milestones', body: <MilestoneRows milestones={milestones} /> },
    ...(progress.length
      ? [
          {
            name: 'Latest progress',
            body: (
              <ul className="progress-list">
                {progress.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <time className="muted small" dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleDateString()}
                    </time>
                    <p>{e.body}</p>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
  ];
  const last = slides.length - 1;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') setIndex((i) => Math.min(last, i + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  const slide = slides[index];
  return (
    <dialog ref={ref} className="deck" onCancel={onClose} onClose={onClose} aria-labelledby="deck-title">
      <header className="deck-head">
        <span className="muted">{title} · Project bulletin</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Close ✕
        </button>
      </header>
      <div className="deck-slide" aria-live="polite">
        <h2 id="deck-title">{slide.name}</h2>
        {slide.body}
      </div>
      <footer className="deck-foot">
        <button type="button" className="btn btn-secondary" onClick={() => setIndex(index - 1)} disabled={index === 0}>
          ← Back
        </button>
        <span className="muted">
          {index + 1} / {slides.length}
        </span>
        <button type="button" className="btn btn-primary" onClick={() => setIndex(index + 1)} disabled={index === last}>
          Next →
        </button>
      </footer>
    </dialog>
  );
}
