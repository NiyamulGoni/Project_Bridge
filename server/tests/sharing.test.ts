/**
 * Step 10 / FR12: public share links. They carry the Guest card and nothing more.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createProject, createUser, prisma, request, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('Share links', () => {
  it('returns only the URL, title, short summary and thumbnail, without touching the guest budget', async () => {
    const owner = await createUser();
    const project = await createProject(owner.id, { summary: 'S'.repeat(300), overview: 'SECRET-OVERVIEW '.repeat(20), problem: 'SECRET-PROBLEM', thumbnailUrl: '/demo-covers/pump.jpg' });
    const res = await request(app).get(`/api/projects/${project.id}/share`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['summary', 'thumbnailUrl', 'title', 'url']);
    expect(res.body.url).toBe(`http://localhost:5173/projects/${project.id}`);
    expect(res.body.summary.length).toBeLessThanOrEqual(150);
    expect(res.body.thumbnailUrl).toBe('http://localhost:5173/demo-covers/pump.jpg');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.guestSession.count()).toBe(0);

    const page = await request(app).get(`/p/${project.id}`);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.text).toContain(`<meta property="og:url" content="http://localhost:5173/projects/${project.id}">`);
    for (const body of [JSON.stringify(res.body), page.text]) {
      expect(body).not.toContain('SECRET-');
      expect(body).not.toContain(owner.email);
      expect(body).not.toContain(owner.name);
    }
  });

  it('escapes a hostile title in the page', async () => {
    const owner = await createUser();
    const hostile = '"><script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://evil.example">';
    const project = await createProject(owner.id, { title: hostile, summary: `'onload="steal()" & more` });
    const page = await request(app).get(`/p/${project.id}`);
    expect(page.text).not.toContain('<script>');
    expect(page.text).not.toContain('url=https://evil.example">');
    expect(page.text).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.text).toContain('&#39;onload=&quot;steal()&quot; &amp; more');
    expect(page.text.match(/<meta http-equiv="refresh"/g)).toHaveLength(1);
  });

  it.each(['DRAFT', 'SUBMITTED', 'HIDDEN', 'REMOVED', 'DELETED'])('a %s project is not shareable', async (status) => {
    const owner = await createUser();
    const project = await createProject(owner.id, { status });
    expect((await request(app).get(`/api/projects/${project.id}/share`)).status).toBe(404);
    expect((await request(app).get(`/p/${project.id}`)).status).toBe(404);
  });
});
