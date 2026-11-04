import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError, type FeedPage, type ProjectCard as Card, type SearchPage } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { CardSkeleton } from '../components/CardSkeleton';
import { GuestCapPrompt } from '../components/GuestCapPrompt';
import { ProjectCard } from '../components/ProjectCard';
import { SearchBar } from '../components/SearchBar';

const TIER_NOTES: Record<FeedPage['tier'], string> = {
  GUEST: 'Guest preview · up to 20 projects',
  UPLOADER: 'Uploader view · overviews up to 500 characters',
  PROFESSIONAL: 'Professional view · full overviews and teams',
};

export function Explore() {
  const { user, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tagParam = params.get('tags') ?? '';
  const tags = useMemo(() => tagParam.split(',').filter(Boolean), [tagParam]);
  // FR06: search is for signed-in users; guests always get the feed.
  const searching = Boolean(user) && (q !== '' || tags.length > 0);

  const [items, setItems] = useState<Card[]>([]);
  const [page, setPage] = useState(0);
  const [tier, setTier] = useState<FeedPage['tier'] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [capLimit, setCapLimit] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadPage = useCallback(
    async (next: number, replace: boolean) => {
      setLoading(true);
      setError('');
      try {
        const path = searching
          ? `/projects/search?${new URLSearchParams({ q, tags: tags.join(','), page: String(next) })}`
          : `/projects/feed?page=${next}`;
        const res = await api<FeedPage | SearchPage>(path);
        setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
        setPage(next);
        setTier(res.tier);
        setHasMore(res.hasMore);
        setTotal('total' in res ? res.total : null);
        setCapLimit(res.guest?.capReached ? res.guest.limit : null);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'GUEST_LIMIT') {
          setHasMore(false);
          setCapLimit(20);
        } else setError(err instanceof ApiError ? err.message : 'Could not load projects.');
      } finally {
        setLoading(false);
      }
    },
    [searching, q, tags],
  );

  // Reload from the first page whenever the viewer or the search changes.
  useEffect(() => {
    if (!authLoading) void loadPage(1, true);
  }, [authLoading, user?.id, loadPage]);

  function search(nextQ: string, nextTags: string[]) {
    const next = new URLSearchParams();
    if (nextQ) next.set('q', nextQ);
    if (nextTags.length) next.set('tags', nextTags.join(','));
    setParams(next);
  }

  const firstLoad = loading && items.length === 0;
  const filterText = [q && `“${q}”`, tags.length > 0 && `tags ${tags.map((t) => `#${t}`).join(' + ')}`].filter(Boolean).join(' with ');

  return (
    <main className="page">
      <section className="hero">
        <h1>Discover university projects</h1>
        <p>From semester projects to real-world possibilities. Browse what students are building and find teams to support.</p>
        {tier && <span className="badge badge-accent">{TIER_NOTES[tier]}</span>}
      </section>

      {user ? (
        <SearchBar q={q} tags={tags} onSearch={search} />
      ) : (
        !authLoading && (
          <p className="muted search-hint">
            <Link to="/login">Sign in</Link> to search projects by name and tags.
          </p>
        )
      )}

      {searching && total !== null && !firstLoad && (
        <div className="row space-between results-bar" role="status">
          <span>
            {total} {total === 1 ? 'project' : 'projects'} matching {filterText}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => search('', [])}>
            Clear filters
          </button>
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {firstLoad ? (
        <div className="grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
          <span className="visually-hidden" role="status">
            Loading projects…
          </span>
        </div>
      ) : items.length > 0 ? (
        <div className="grid">
          {items.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      ) : (
        !error &&
        (searching ? (
          <div className="card empty">
            <h2>No projects match {filterText}</h2>
            <p className="muted">
              Try fewer tags, since every selected tag must match, or check the spelling of the project name.
            </p>
            <div className="actions" style={{ marginTop: 16 }}>
              {tags.length > 0 && q && (
                <button type="button" className="btn btn-secondary" onClick={() => search(q, [])}>
                  Search “{q}” without tags
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => search('', [])}>
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          <div className="card empty">
            <h2>No projects yet</h2>
            <p className="muted">Published projects will appear here.</p>
          </div>
        ))
      )}

      {!firstLoad && hasMore && (
        <div className="center">
          <button type="button" className="btn btn-secondary btn-lg" onClick={() => loadPage(page + 1, false)} disabled={loading}>
            {loading ? 'Loading…' : searching ? 'Load more results' : 'Load more projects'}
          </button>
        </div>
      )}
      {capLimit !== null && <GuestCapPrompt limit={capLimit} />}
    </main>
  );
}
