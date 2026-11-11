import { Link } from 'react-router';
import { MILESTONE_LABELS, STAGE_LABELS, type ProjectDetail, type ViewerTier } from '../api';
import { Avatar } from './Avatar';
import { ContactButton } from './ContactButton';
import { Engagement } from './Engagement';
import { ReportButton } from './ReportButton';

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </>
  );
}

function Locked({ children }: { children: React.ReactNode }) {
  return (
    <p className="locked-note">
      <span aria-hidden="true">🔒</span> {children}
    </p>
  );
}

/**
 * FR07: renders whatever the server sent for this viewer. Restricted fields never reach the
 * browser, so this only decides how to explain what is missing.
 */
export function ProjectView({ project, tier }: { project: ProjectDetail; tier: ViewerTier }) {
  const isPro = tier === 'PROFESSIONAL';
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
                {tag}
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
          {tier !== 'GUEST' && <ReportButton targetType="PROJECT" targetId={project.id} label="Report project" />}
        </div>
      </header>

      {tier === 'GUEST' ? (
        <section className="card card-pad stack">
          <Locked>
            The overview, demo and team are for members. <Link to="/register">Create a free account</Link> or{' '}
            <Link to="/login">sign in</Link> to read more.
          </Locked>
        </section>
      ) : (
        <>
          {project.problem && (
            <section className="card card-pad stack" aria-labelledby="problem-title">
              <h2 id="problem-title">Problem</h2>
              <Paragraphs text={project.problem} />
            </section>
          )}
          {project.overview && (
            <section className="card card-pad stack" aria-labelledby="overview-title">
              <h2 id="overview-title">{isPro ? 'Solution and overview' : 'Overview'}</h2>
              <Paragraphs text={project.overview} />
              {overviewTruncated && <Locked>Professionals see the full overview, roadmap and team.</Locked>}
            </section>
          )}
        </>
      )}

      {project.comments && <Engagement project={project} />}

      {project.screenshots && project.screenshots.length > 0 && (
        <section className="card card-pad stack" aria-labelledby="shots-title">
          <h2 id="shots-title">Screenshots</h2>
          <div className="screenshot-grid">
            {project.screenshots.map((s, i) => (
              <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer">
                <img src={s.url} alt={`${project.title} screenshot ${i + 1}`} loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      )}

      {project.milestones && project.milestones.length > 0 && (
        <section className="card card-pad stack" aria-labelledby="milestones-title">
          <h2 id="milestones-title">Milestones</h2>
          <ol className="milestone-list">
            {project.milestones.map((m) => (
              <li key={m.id} className={`milestone milestone-${m.status.toLowerCase()}`}>
                <span className="milestone-dot" aria-hidden="true" />
                <span className="milestone-title">{m.title}</span>
                <span className={`badge ${m.status === 'DONE' ? 'badge-success' : m.status === 'IN_PROGRESS' ? 'badge-accent' : ''}`}>
                  {MILESTONE_LABELS[m.status]}
                </span>
                {m.dueDate && <span className="muted small">due {new Date(m.dueDate).toLocaleDateString()}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

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
