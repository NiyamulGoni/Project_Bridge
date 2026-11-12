import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';

interface Suggestion {
  kind: 'search' | 'project';
  text: string;
  id?: string;
  score: number;
}

interface Props {
  q: string;
  tags: string[];
  onSearch: (q: string, tags: string[]) => void;
}

const MAX_TAGS = 8;

/** FR06: the Explore filters, in a sidebar. Project-name text plus tags; every selected tag must match. */
export function FilterSidebar({ q, tags, onSearch }: Props) {
  const navigate = useNavigate();
  const [text, setText] = useState(q);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<Array<{ tag: string; count: number }>>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => setText(q), [q]);

  useEffect(() => {
    api<{ items: Array<{ tag: string; count: number }> }>('/projects/tags')
      .then((res) => setAvailable(res.items))
      .catch(() => setAvailable([]));
  }, []);

  // Debounced suggestions (last week's searches and reactions) while the box is open; stale answers are ignored.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    const timer = setTimeout(() => {
      api<{ items: Suggestion[] }>(`/projects/suggest?${new URLSearchParams({ q: text.trim() })}`)
        .then((res) => {
          if (!stale) {
            setItems(res.items);
            setActiveIdx(-1);
          }
        })
        .catch(() => !stale && setItems([]));
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [text, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function pick(s: Suggestion) {
    setOpen(false);
    if (s.kind === 'project' && s.id) navigate(`/projects/${s.id}`);
    else {
      setText(s.text);
      onSearch(s.text, tags);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') setOpen(false);
    else if (open && items.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActiveIdx((i) => (e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0 && items[activeIdx]) {
      e.preventDefault();
      pick(items[activeIdx]);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setOpen(false);
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
        <div className="suggest-wrap" ref={box}>
          <input
            id="search-q"
            className="input"
            type="search"
            placeholder="Search by name…"
            value={text}
            maxLength={100}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls="search-suggestions"
            aria-activedescendant={activeIdx >= 0 ? `suggest-${activeIdx}` : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          {open && items.length > 0 && (
            <ul id="search-suggestions" className="suggest-list card" role="listbox" aria-label={text.trim() ? 'Suggestions' : 'Trending this week'}>
              {!text.trim() && (
                <li className="suggest-head" role="presentation">
                  Trending this week
                </li>
              )}
              {items.map((s, i) => (
                <li
                  key={`${s.kind}-${s.id ?? s.text}`}
                  id={`suggest-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  className={`suggest-item${i === activeIdx ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(s);
                  }}
                >
                  <span>{s.text}</span>
                  <span className="suggest-kind">{s.kind === 'project' ? 'Project' : 'Search'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
