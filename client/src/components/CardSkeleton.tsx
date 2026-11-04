/** Placeholder card shown while the feed loads. */
export function CardSkeleton() {
  return (
    <div className="card project-card" aria-hidden="true">
      <div className="skeleton" style={{ height: 112, borderRadius: 0 }} />
      <div className="project-body">
        <div className="skeleton" style={{ height: 18, width: '35%' }} />
        <div className="skeleton" style={{ height: 20, width: '80%' }} />
        <div className="skeleton" style={{ height: 14, width: '100%' }} />
        <div className="skeleton" style={{ height: 14, width: '90%' }} />
      </div>
    </div>
  );
}
