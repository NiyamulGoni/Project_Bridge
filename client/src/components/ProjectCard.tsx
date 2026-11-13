import { Link } from 'react-router';
import { STAGE_LABELS, type ProjectCard as Card } from '../api';
import { Avatar } from './Avatar';

// Cover gradients; the first tag picks one so related projects look alike.
const COVERS = [
  'linear-gradient(135deg, #0f766e, #14b8a6)',
  'linear-gradient(135deg, #1b3352, #3b82f6)',
  'linear-gradient(135deg, #4338ca, #8b5cf6)',
  'linear-gradient(135deg, #b45309, #f59e0b)',
  'linear-gradient(135deg, #be123c, #f43f5e)',
  'linear-gradient(135deg, #047857, #22c55e)',
];

export function coverFor(project: Pick<Card, 'tags' | 'title'>): string {
  const key = project.tags[0] ?? project.title;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COVERS[hash % COVERS.length];
}

export function ProjectCard({ project }: { project: Card }) {
  return (
    <article className="card project-card">
      <div className={`project-cover${project.thumbnailUrl ? ' has-image' : ''}`} style={{ background: coverFor(project) }} aria-hidden="true">
        {project.thumbnailUrl ? (
          <img src={project.thumbnailUrl} alt="" />
        ) : (
          <span className="project-initial">{project.title.charAt(0)}</span>
        )}
      </div>
      <div className="project-body">
        <div className="project-meta">
          <span className="badge badge-amber">{STAGE_LABELS[project.stage] ?? project.stage}</span>
          {project.isSynthetic && <span className="badge">Demo data</span>}
        </div>
        <h2 className="project-title">
          {/* FR07: the whole card is clickable through this link's stretched hit area. */}
          <Link to={`/projects/${project.id}`} className="stretched-link">
            {project.title}
          </Link>
        </h2>
        <p className="project-summary">{project.summary}</p>
        {project.tags.length > 0 && (
          <ul className="chips" aria-label="Tags">
            {project.tags.map((tag) => (
              <li key={tag} className="chip-item">
                {/* Everyone can search by tag; the chip runs that search at once. */}
                <Link to={`/?tags=${encodeURIComponent(tag)}`} className="chip chip-link">
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {project.overview && (
          <details className="project-overview">
            <summary>Read overview</summary>
            {project.overview.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </details>
        )}
        {project.owner && (
          <div className="project-footer">
            <Avatar name={project.owner.name} size={22} />
            <span>By {project.owner.name}</span>
            {project.likeCount !== undefined && (
              <span className="engagement-counts" aria-label={`${project.likeCount} likes, ${project.commentCount ?? 0} comments`}>
                <span aria-hidden="true">♥ {project.likeCount}</span>
                <span aria-hidden="true">💬 {project.commentCount ?? 0}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
