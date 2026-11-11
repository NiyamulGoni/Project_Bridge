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

/** FR06: project-name search with live suggestions from the last week's searches and reactions. */
export function SearchBar({ q, tags, onSearch }: Props) {
  const navigate = useNavigate();
  const [text, setText] = useState(q);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setText(q), [q]);

  // Debounced lookup while the box is open; stale answers are ignored.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    const timer = setTimeout(() => {
      api<{ items: Suggestion[] }>(`/projects/suggest?${new URLSearchParams({ q: text.trim() })}`)
        .then((res) => {
          if (!stale) {
            setItems(res.items);
            setActive(-1);
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

  function submit(e: FormEvent) {
    e.preventDefault();
    setOpen(false);
    onSearch(text.trim(), tags);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') setOpen(false);
    else if (open && items.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1));
    } else if (e.key === 'Enter' && active >= 0 && items[active]) {
      e.preventDefault();
      pick(items[active]);
    }
  }

  return (
    <form className="search-bar card card-pad" role="search" onSubmit={submit}>
      <div className="row">
        <div className="suggest-wrap" ref={box}>
          <label htmlFor="search-q" className="visually-hidden">
            Search projects by name
          </label>
          <input
            id="search-q"
            className="input"
            type="search"
            placeholder="Search projects by name…"
            value={text}
            maxLength={100}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls="search-suggestions"
            aria-activedescendant={active >= 0 ? `suggest-${active}` : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          {open && items.length > 0 && (
            <ul id="search-suggestions" className="suggest-list card" role="listbox" aria-label={text.trim() ? 'Suggestions' : 'Trending this week'}>
              {!text.trim() && <li className="suggest-head" role="presentation">Trending this week</li>}
              {items.map((s, i) => (
                <li
                  key={`${s.kind}-${s.id ?? s.text}`}
                  id={`suggest-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`suggest-item${i === active ? ' active' : ''}`}
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
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </div>
    </form>
  );
}
