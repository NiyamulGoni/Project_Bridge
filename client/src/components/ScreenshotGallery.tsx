import { useEffect, useRef, useState } from 'react';

interface Shot {
  id: string;
  url: string;
}

/** App Store-style screenshot strip: scrolls sideways, snaps to each image, opens full size on click. */
export function ScreenshotGallery({ title, shots }: { title: string; shots: Shot[] }) {
  const strip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  function updateEdges() {
    const el = strip.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }
  useEffect(updateEdges, [shots.length]);

  const scroll = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <section className="card card-pad stack gallery-card" aria-labelledby="gallery-title">
      <div className="row space-between">
        <h2 id="gallery-title">Screenshots</h2>
        {shots.length > 1 && (
          <div className="row gallery-arrows">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => scroll(-1)} disabled={edges.start} aria-label="Previous screenshots">
              ←
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => scroll(1)} disabled={edges.end} aria-label="More screenshots">
              →
            </button>
          </div>
        )}
      </div>
      <div className="gallery" ref={strip} onScroll={updateEdges}>
        {shots.map((s, i) => (
          <button key={s.id} type="button" className="gallery-item" onClick={() => setOpen(i)} aria-label={`Open screenshot ${i + 1} of ${shots.length}`}>
            <img src={s.url} alt={`${title} screenshot ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>
      {open !== null && <Lightbox title={title} shots={shots} start={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Lightbox({ title, shots, start, onClose }: { title: string; shots: Shot[]; start: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(start);
  const last = shots.length - 1;

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(last, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  return (
    <dialog ref={ref} className="lightbox" onCancel={onClose} onClose={onClose} aria-label={`${title} screenshots`}>
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <img src={shots[index].url} alt={`${title} screenshot ${index + 1}`} />
      {shots.length > 1 && (
        <div className="lightbox-nav">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIndex(index - 1)} disabled={index === 0}>
            ← Back
          </button>
          <span>
            {index + 1} / {shots.length}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIndex(index + 1)} disabled={index === last}>
            Next →
          </button>
        </div>
      )}
    </dialog>
  );
}
