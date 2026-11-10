import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

interface Props {
  q: string;
  tags: string[];
  onSearch: (q: string, tags: string[]) => void;
}

const MAX_TAGS = 8;

/** FR06: the Explore filters, in a sidebar. Project-name text plus tags; every selected tag must match. */
export function FilterSidebar({ q, tags, onSearch }: Props) {
  const [text, setText] = useState(q);
  const [available, setAvailable] = useState<Array<{ tag: string; count: number }>>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => setText(q), [q]);

  useEffect(() => {
    api<{ items: Array<{ tag: string; count: number }> }>('/projects/tags')
      .then((res) => setAvailable(res.items))
      .catch(() => setAvailable([]));
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSearch(text.trim(), tags);
  }

  function toggle(tag: string) {
    onSearch(text.trim(), tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag].slice(0, MAX_TAGS));
  }

  // A selected tag stays listed even if it is not among the most common ones.
  const known = new Set(available.map((a) => a.tag));
  const all = [...tags.filter((t) => !known.has(t)).map((tag) => ({ tag, count: null as number | null })), ...available];
  const shown = showAll ? all : all.slice(0, 12);
  const active = q !== '' || tags.length > 0;

  return (
    <form className="filters card" role="search" onSubmit={submit} aria-label="Filter projects">
      <div className="filters-head">
        <h2>Filters</h2>
        {active && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSearch('', [])}>
            Clear all
          </button>
        )}
      </div>

      <div className="filters-group">
        <label htmlFor="search-q" className="filters-label">
          Project name
        </label>
        <input id="search-q" className="input" type="search" placeholder="Search by name…" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm btn-block">
          Search
        </button>
      </div>

      {all.length > 0 && (
        <fieldset className="filters-group">
          <legend className="filters-label">
            Tags {tags.length > 0 && <span className="badge badge-accent">{tags.length}</span>}
          </legend>
          <p className="muted small">Projects must have every tag you tick.</p>
          <ul className="filters-tags">
            {shown.map(({ tag, count }) => {
              const on = tags.includes(tag);
              return (
                <li key={tag}>
                  <label className={`filters-tag${on ? ' on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(tag)} disabled={!on && tags.length >= MAX_TAGS} />
                    <span className="filters-tag-name">#{tag}</span>
                    {count !== null && <span className="filters-tag-count">{count}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          {all.length > 12 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer tags' : `Show all ${all.length} tags`}
            </button>
          )}
        </fieldset>
      )}
    </form>
  );
}
