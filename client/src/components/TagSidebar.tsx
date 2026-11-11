import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
}

/** A fixed list of tags beside the feed; every tag is a button and all selected tags must match. */
export function TagSidebar({ tags, onChange }: Props) {
  const [available, setAvailable] = useState<Array<{ tag: string; count: number }>>([]);

  useEffect(() => {
    api<{ items: Array<{ tag: string; count: number }> }>('/projects/tags')
      .then((res) => setAvailable(res.items))
      .catch(() => setAvailable([]));
  }, []);

  function toggle(tag: string) {
    onChange(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag].slice(0, 8));
  }

  const list = [...tags.filter((t) => !available.some((a) => a.tag === t)).map((tag) => ({ tag, count: 0 })), ...available];
  if (list.length === 0) return null;

  return (
    <aside className="tag-sidebar card card-pad" aria-label="Filter by tags">
      <h2 className="tag-sidebar-title">Tags</h2>
      <p className="muted tag-sidebar-note">Every selected tag must match.</p>
      <div className="tag-filter" role="group" aria-label="Tags">
        {list.map(({ tag, count }) => {
          const on = tags.includes(tag);
          return (
            <button key={tag} type="button" className={`chip chip-toggle${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(tag)}>
              {tag}
              {count > 0 && <span className="chip-count"> {count}</span>}
            </button>
          );
        })}
      </div>
      {tags.length > 0 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])}>
          Clear tags
        </button>
      )}
    </aside>
  );
}
