import { useState, type ReactNode } from 'react';

/**
 * Turns the plain problem and overview text into something people scan rather than read:
 * a problem → solution pair, feature cards and titled cards. It reads the text as written, so
 * no project needs rewriting; the full text is always one click away.
 */

interface Item {
  title: string;
  text: string;
}
interface Story {
  lead: string;
  lists: Array<{ title: string; items: Item[] }>;
  sections: Item[];
  extra: string[];
}

const BULLET = /^([-•*–]|\d+[.)])\s+/;
const LIST_TITLE = /^[^.!?]{2,40}:$/;
const LABELLED = /^([A-Z][^:.!?\n]{1,40}):\s+([\s\S]+)$/;

/** "Drawing tools: pen, line" → a titled item; "Undo / redo history" → a title alone. */
function toItem(line: string): Item {
  const m = line.replace(BULLET, '').match(/^([^:]{2,40}):\s+(.+)$/);
  return m ? { title: m[1].trim(), text: m[2].trim() } : { title: line.replace(BULLET, '').trim(), text: '' };
}

export function parseStory(text: string): Story {
  const story: Story = { lead: '', lists: [], sections: [], extra: [] };
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  let listTitle: string | null = null;

  for (const block of blocks) {
    let lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    // "Key features:" on its own names the list that follows.
    if (lines.length === 1 && LIST_TITLE.test(lines[0])) {
      listTitle = lines[0].slice(0, -1);
      continue;
    }
    // A title on its own line above one paragraph ("How it works:" then text) is a titled card.
    if (lines.length === 2 && LIST_TITLE.test(lines[0]) && lines[1].length > 220) {
      story.sections.push({ title: lines[0].slice(0, -1), text: lines[1] });
      listTitle = null;
      continue;
    }
    if (lines.length > 1 && LIST_TITLE.test(lines[0])) {
      listTitle = lines[0].slice(0, -1);
      lines = lines.slice(1);
    }
    const bulleted = lines.length > 1 && lines.every((l) => BULLET.test(l));
    const shortLines = lines.length > 1 && lines.every((l) => l.length <= 220) && (lines.length >= 3 || listTitle !== null);
    if (bulleted || shortLines) {
      story.lists.push({ title: listTitle ?? 'Highlights', items: lines.map(toItem) });
      listTitle = null;
      continue;
    }
    const paragraph = lines.join(' ');
    if (listTitle !== null && lines.length === 1) {
      story.sections.push({ title: listTitle, text: paragraph });
      listTitle = null;
      continue;
    }
    listTitle = null;
    const labelled = paragraph.match(LABELLED);
    if (labelled) {
      story.sections.push({ title: labelled[1].trim(), text: labelled[2].trim() });
    } else if (!story.lead) {
      story.lead = paragraph;
    } else if (story.sections.length) {
      // An untitled paragraph after a titled one continues it.
      const prev = story.sections[story.sections.length - 1];
      prev.text = `${prev.text}\n\n${paragraph}`;
    } else {
      story.extra.push(paragraph);
    }
  }
  return story;
}

/** The first sentence, used as a headline. */
function firstSentence(text: string): [string, string] {
  const m = text.match(/^(.{20,220}?[.!?])\s+([\s\S]*)$/);
  return m ? [m[1], m[2]] : [text, ''];
}

function Expandable({ text, limit = 260 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  const shown = !long || open ? text : `${text.slice(0, limit).replace(/\s+\S*$/, '')}…`;
  return (
    <>
      {shown.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {long && (
        <button type="button" className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </>
  );
}

const ICONS: Record<string, ReactNode> = {
  problem: <path d="M12 8v5m0 3.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  solution: <path d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  flow: <path d="M4 6h10M4 12h16M4 18h7m9-12-3-3m3 3-3 3" />,
  code: <path d="m8 8-5 4 5 4m8-8 5 4-5 4M14 4l-4 16" />,
  data: <path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  cloud: <path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.3 4.5 4.5 0 0 0 7 18Z" />,
  users: <path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />,
  spark: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8" />,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="story-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function iconFor(title: string): keyof typeof ICONS {
  const t = title.toLowerCase();
  if (/how|work|flow|process|step/.test(t)) return 'flow';
  if (/tech|stack|built|front|back|architecture|code/.test(t)) return 'code';
  if (/data|database|storage|store/.test(t)) return 'data';
  if (/deploy|cloud|host|server/.test(t)) return 'cloud';
  if (/user|who|audience|team|people/.test(t)) return 'users';
  return 'spark';
}

export function ProjectStory({ problem, overview, truncated }: { problem?: string; overview?: string; truncated?: boolean }) {
  if (!problem && !overview) return null;
  const story = parseStory(overview ?? '');
  const [problemHead, problemRest] = problem ? firstSentence(problem.replace(/\s*\n+\s*/g, ' ')) : ['', ''];
  const [leadHead, leadRest] = firstSentence(story.lead || story.extra[0] || '');
  const extra = story.lead ? story.extra : story.extra.slice(1);

  return (
    <section className="card card-pad stack story" aria-labelledby="story-title">
      <h2 id="story-title">The idea at a glance</h2>

      <div className={`story-pair${problem ? '' : ' single'}`}>
        {problem && (
          <div className="story-card story-problem">
            <span className="story-badge">
              <Icon name="problem" /> The problem
            </span>
            <p className="story-headline">{problemHead}</p>
            {problemRest && <Expandable text={problemRest} limit={200} />}
          </div>
        )}
        {problem && (leadHead || story.lists.length > 0) && (
          <div className="story-arrow" aria-hidden="true">
            →
          </div>
        )}
        {(leadHead || story.lists.length > 0) && (
          <div className="story-card story-solution">
            <span className="story-badge">
              <Icon name="solution" /> The solution
            </span>
            {leadHead && <p className="story-headline">{leadHead}</p>}
            {leadRest && <Expandable text={leadRest} limit={200} />}
          </div>
        )}
      </div>

      {story.lists.map((list, i) => (
        <div key={i} className="stack">
          <h3 className="bulletin-label">{list.title}</h3>
          <ul className="feature-grid">
            {list.items.map((item, j) => (
              <li key={j} className="feature">
                <span className="feature-check">
                  <Icon name="check" />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  {item.text && <span className="feature-text">{item.text}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {story.sections.length > 0 && (
        <div className="story-sections">
          {story.sections.map((s, i) => (
            <div key={i} className="story-section">
              <span className="story-section-icon">
                <Icon name={iconFor(s.title)} />
              </span>
              <h3>{s.title}</h3>
              <Expandable text={s.text} limit={220} />
            </div>
          ))}
        </div>
      )}

      {extra.length > 0 && (
        <div className="story-section">
          <h3>More about it</h3>
          <Expandable text={extra.join('\n\n')} limit={220} />
        </div>
      )}

      <details className="story-full">
        <summary>Read the full text</summary>
        {problem && (
          <>
            <h3>Problem</h3>
            {problem.split(/\n{2,}/).map((p, i) => (
              <p key={`p${i}`}>{p}</p>
            ))}
          </>
        )}
        {overview && (
          <>
            <h3>Solution and overview</h3>
            {overview.split(/\n{2,}/).map((p, i) => (
              <p key={`o${i}`} className="story-pre">
                {p}
              </p>
            ))}
          </>
        )}
      </details>
      {truncated && (
        <p className="locked-note">
          <span aria-hidden="true">🔒</span> Professionals see the full problem, overview and team.
        </p>
      )}
    </section>
  );
}
