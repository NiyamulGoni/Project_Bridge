import { useState } from 'react';
import { Link } from 'react-router';
import { OFFER_TYPE_LABELS, STAGE_LABELS, type ProjectDetail, type ViewerTier } from '../api';
import { Avatar } from './Avatar';
import { ContactButton } from './ContactButton';
import { Engagement } from './Engagement';
import { ProjectBulletin } from './ProjectBulletin';
import { ProjectStory } from './ProjectStory';
import { ScreenshotGallery } from './ScreenshotGallery';
import { ReportButton } from './ReportButton';

function Locked({ children }: { children: React.ReactNode }) {
  return (
    <p className="locked-note">
      <span aria-hidden="true">🔒</span> {children}
    </p>
  );
}

/** FR12: copies the public share link, which shows a preview card on social media and grants no extra access. */
function ShareButton({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'shown'>('idle');
  const link = `${window.location.origin}/p/${id}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setState('copied');
    } catch {
      setState('shown');
    }
  }
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
        {state === 'copied' ? '✓ Link copied' : 'Share'}
      </button>
      {state === 'shown' && <input className="input" readOnly value={link} aria-label="Share link" onFocus={(e) => e.target.select()} />}
    </>
  );
}

/**
 * FR07: renders whatever the server sent for this viewer. Restricted fields never reach the
 * browser, so this only decides how to explain what is missing.
 */
export function ProjectView({ project, tier, canEdit = false }: { project: ProjectDetail; tier: ViewerTier; canEdit?: boolean }) {
  const overviewTruncated = tier === 'UPLOADER' && project.overview?.endsWith('…');

  return (
    <article className="project-view stack">
      <header className="card card-pad stack project-view-head">
        <div className="project-meta">
          <span className="badge badge-amber">{STAGE_LABELS[project.stage] ?? project.stage}</span>
          {project.isSynthetic && <span className="badge">Demo data</span>}
        </div>
        <h1>{project.title}</h1>
        {project.summary && <p className="lead">{project.summary}</p>}
        {project.tags.length > 0 && (
          <ul className="chips" aria-label="Tags">
            {project.tags.map((tag) => (
              <li key={tag} className="chip">
                #{tag}
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          {project.demoUrl && (
            <a className="btn btn-primary" href={project.demoUrl} target="_blank" rel="noopener noreferrer">
              Open demo ↗
            </a>
          )}
          {tier !== 'GUEST' && <ContactButton projectId={project.id} name="the team" label="Contact the team" />}
          <ShareButton id={project.id} />
          {tier !== 'GUEST' && <ReportButton targetType="PROJECT" targetId={project.id} label="Report project" />}
        </div>
      </header>

      {project.screenshots && project.screenshots.length > 0 && <ScreenshotGallery title={project.title} shots={project.screenshots} />}

      <ProjectBulletin title={project.title} stage={project.stage} milestones={project.milestones} progress={project.progress} completion={project.completion} projectId={project.id} editable={canEdit} />

      {tier === 'GUEST' ? (
        <section className="card card-pad stack">
          <Locked>
            The overview, demo and team are for members. <Link to="/register">Create a free account</Link> or{' '}
            <Link to="/login">sign in</Link> to read more.
          </Locked>
        </section>
      ) : (
        <ProjectStory problem={project.problem} overview={project.overview} truncated={overviewTruncated} />
      )}


      {project.offers && project.offers.length > 0 && (
        <section className="card card-pad stack" aria-labelledby="offers-title">
          <h2 id="offers-title">Paid offers</h2>
          {project.offers.map((o) => (
            <div key={o.id} className="offer stack">
              <div className="row space-between">
                <strong>{o.title}</strong>
                <span className="badge badge-amber">
                  {OFFER_TYPE_LABELS[o.type] ?? o.type} · {o.compensation} {o.currency}
                </span>
              </div>
              <ul className="chips" aria-label="Skills">
                {o.skills.map((s) => (
                  <li key={s} className="chip">
                    {s}
                  </li>
                ))}
              </ul>
              <p className="comment-body">{o.applicationRoute}</p>
              <div className="row">
                <ContactButton offerId={o.id} name="the offer’s author" label="Apply" className="btn btn-primary btn-sm" />
                <ReportButton targetType="OFFER" targetId={o.id} />
              </div>
            </div>
          ))}
          <p className="muted small">{project.offers[0].paymentNotice}</p>
        </section>
      )}

      {project.comments && <Engagement project={project} />}

      {project.progress && project.progress.length > 0 && (
        <section className="card card-pad stack" aria-labelledby="progress-title">
          <h2 id="progress-title">Progress updates</h2>
          <ul className="progress-list">
            {project.progress.map((e) => (
              <li key={e.id}>
                <time className="muted small" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleDateString()}
                </time>
                <p>{e.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.team && (
        <section className="card card-pad stack" aria-labelledby="team-title">
          <h2 id="team-title">Team</h2>
          <ul className="team-list">
            {project.team.map((m, i) => (
              <li key={`${m.name}-${i}`}>
                <Avatar name={m.name} size={32} />
                <span>{m.name}</span>
                <span className="badge">{m.role === 'OWNER' ? 'Owner' : 'Editor'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
