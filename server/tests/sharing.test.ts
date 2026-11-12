/**
 * Step 10 / FR12: public share links. They carry the Guest card and nothing more.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createProject, createUser, prisma, request, resetDb, signedInAgent } from './helpers.js';

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

describe('Social media share links', () => {
  async function setup() {
    const owner = await createUser();
    const project = await createProject(owner.id, { title: 'Solar & Pump' });
    const path = `/api/projects/${project.id}/share-links`;
    return { owner, project, path };
  }

  it('gives a Professional the links, pointing only at the public share page', async () => {
    const { project, path } = await setup();
    const pro = await createUser({ role: 'PROFESSIONAL' });
    const res = await (await signedInAgent(pro.email)).get(path);
    expect(res.status).toBe(200);
    const shareUrl = `http://localhost:5173/p/${project.id}`;
    expect(res.body.url).toBe(shareUrl);
    expect(res.body.links.map((l: { service: string }) => l.service)).toEqual(['linkedin', 'facebook', 'x', 'whatsapp']);
    for (const link of res.body.links) {
      expect(Object.keys(link).sort()).toEqual(['href', 'label', 'service']);
      expect(link.href).toMatch(/^https:\/\//);
      expect(link.href).toContain(encodeURIComponent(shareUrl));
    }
    // The title is encoded, never pasted raw into a link.
    expect(res.body.links[2].href).toContain('Solar%20%26%20Pump');
  });

  it('gives the owner and an accepted team member the links', async () => {
    const { owner, project, path } = await setup();
    expect((await (await signedInAgent(owner.email)).get(path)).status).toBe(200);

    const member = await createUser();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.id, status: 'ACCEPTED', invitedById: owner.id } });
    expect((await (await signedInAgent(member.email)).get(path)).status).toBe(200);
  });

  it('refuses a Guest, another Uploader, an invited-only user and an Admin', async () => {
    const { owner, project, path } = await setup();
    expect((await request(app).get(path)).status).toBe(401);

    const other = await createUser();
    const refused = await (await signedInAgent(other.email)).get(path);
    expect(refused.status).toBe(403);
    expect(refused.body.links).toBeUndefined();

    const invited = await createUser();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: invited.id, status: 'INVITED', invitedById: owner.id } });
    expect((await (await signedInAgent(invited.email)).get(path)).status).toBe(403);

    const admin = await createUser({ role: 'ADMIN' });
    expect((await (await signedInAgent(admin.email)).get(path)).status).toBe(403);
  });

  it.each(['DRAFT', 'HIDDEN', 'REMOVED', 'DELETED'])('gives nobody links for a %s project, not even its owner', async (status) => {
    const owner = await createUser();
    const project = await createProject(owner.id, { status });
    expect((await (await signedInAgent(owner.email)).get(`/api/projects/${project.id}/share-links`)).status).toBe(404);
  });
});
