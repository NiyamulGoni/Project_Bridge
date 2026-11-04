import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, STATUS_LABELS, type ProjectDetail, type ProjectStatus } from '../api';
import { Alert } from '../components/Alert';
import { ProjectView } from '../components/ProjectView';

interface Preview {
  project: ProjectDetail;
  status: ProjectStatus;
  showsPendingRevision: boolean;
}

/** FR02: the owner sees the draft (or pending changes) exactly as a Professional would. */
export function ProjectPreview() {
  const { id = '' } = useParams();
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Preview>(`/projects/${id}/preview`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the preview.'));
  }, [id]);

  return (
    <main className="page page-narrow stack">
      <div className="row space-between">
        <Link to={`/projects/${id}/edit`} className="back-link">
          ← Back to editing
        </Link>
        {data && <span className={`badge ${STATUS_LABELS[data.status].badge}`}>{STATUS_LABELS[data.status].label}</span>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {data && (
        <>
          <Alert tone="info">
            Preview of the Professional view{data.showsPendingRevision ? ', including your changes waiting for review' : ''}. Guests and
            Uploaders see less.
          </Alert>
          <ProjectView project={data.project} tier="PROFESSIONAL" />
        </>
      )}
    </main>
  );
}
