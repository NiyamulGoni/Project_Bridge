import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

interface Props {
  q: string;
  tags: string[];
  onSearch: (q: string, tags: string[]) => void;
}

/** FR06: project-name text plus tag chips; every selected tag must match. */
export function SearchBar({ q, tags, onSearch }: Props) {
  const [text, setText] = useState(q);
  const [available, setAvailable] = useState<string[]>([]);

  useEffect(() => setText(q), [q]);

  useEffect(() => {
    api<{ items: Array<{ tag: string }> }>('/projects/tags')
      .then((res) => setAvailable(res.items.map((i) => i.tag)))
      .catch(() => setAvailable([]));
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSearch(text.trim(), tags);
  }

  function toggle(tag: string) {
    onSearch(text.trim(), tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag].slice(0, 8));
  }

  // Selected tags first, then the most common others.
  const chips = [...tags, ...available.filter((t) => !tags.includes(t))].slice(0, Math.max(16, tags.length));

  return (
    <form className="search-bar card card-pad stack" role="search" onSubmit={submit}>
      <div className="row">
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
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </div>
      {chips.length > 0 && (
        <div className="tag-filter" role="group" aria-label="Filter by tags (all selected tags must match)">
          {chips.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button key={tag} type="button" className={`chip chip-toggle${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(tag)}>
                #{tag}
              </button>
            );
          })}
        </div>
      )}
    </form>
  );
}
