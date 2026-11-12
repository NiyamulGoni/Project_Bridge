/**
 * AT02 / FR02: drafts, ownership declaration, HTTPS demo link, Admin review, optional screenshots.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, COMPLETE_PROJECT, coverStorage, createUser, PNG_BYTES, prisma, request, resetDb, signedInAgent, storage } from './helpers.js';

beforeEach(resetDb);

async function uploaderAgent() {
  const user = await createUser({ role: 'UPLOADER' });
  return { user, agent: await signedInAgent(user.email) };
}

describe('Drafts', () => {
  it('saves a draft with only a title', async () => {
    const { agent } = await uploaderAgent();
    const res = await agent.post('/api/projects').send({ title: 'Just an idea' });
    expect(res.status).toBe(201);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(project.status).toBe('DRAFT');
  });

  it('lets a Professional create a project but not a Guest or an Admin', async () => {
    const pro = await createUser({ role: 'PROFESSIONAL' });
    expect((await (await signedInAgent(pro.email)).post('/api/projects').send({ title: 'Pro idea' })).status).toBe(201);

    expect((await request(app).post('/api/projects').send({ title: 'Guest idea' })).status).toBe(401);

    const admin = await createUser({ role: 'ADMIN' });
    expect((await (await signedInAgent(admin.email)).post('/api/projects').send({ title: 'Admin idea' })).status).toBe(403);
  });

  it('rejects a non-HTTPS demonstration link', async () => {
    const { agent } = await uploaderAgent();
    const res = await agent.post('/api/projects').send({ title: 'Insecure demo', demoUrl: 'http://example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.demoUrl).toMatch(/https/);
  });

  it('keeps drafts out of the feed and away from other users', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send(COMPLETE_PROJECT);

    const feed = await request(app).get('/api/projects/feed');
    expect(feed.body.items).toHaveLength(0);
    expect((await request(app).get(`/api/projects/${body.id}`)).status).toBe(404);

    const other = await createUser();
    const otherAgent = await signedInAgent(other.email);
    expect((await otherAgent.get(`/api/projects/${body.id}/workspace`)).status).toBe(404);
    expect((await otherAgent.patch(`/api/projects/${body.id}`).send({ title: 'Hijacked' })).status).toBe(404);
  });
});

describe('Submission and review', () => {
  it('requires the ownership declaration', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send(COMPLETE_PROJECT);
    const res = await agent.post(`/api/projects/${body.id}/submit`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.fields.ownershipDeclared).toBeDefined();
  });

  it('requires every content field and a demo link before submission', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send({ title: 'Incomplete project' });
    const res = await agent.post(`/api/projects/${body.id}/submit`).send({ ownershipDeclared: true });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['summary', 'problem', 'overview', 'tags', 'demoUrl']));
  });

  it('shows the full draft in preview, then publishes it once an Admin approves', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send(COMPLETE_PROJECT);

    const preview = await agent.get(`/api/projects/${body.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.project.problem).toBe(COMPLETE_PROJECT.problem);
    expect(preview.body.project.demoUrl).toBe(COMPLETE_PROJECT.demoUrl);

    const submit = await agent.post(`/api/projects/${body.id}/submit`).send({ ownershipDeclared: true });
    expect(submit.status).toBe(200);
    // Locked while under review.
    expect((await agent.patch(`/api/projects/${body.id}`).send({ title: 'Changed title' })).status).toBe(409);
    expect((await request(app).get('/api/projects/feed')).body.items).toHaveLength(0);

    const admin = await createUser({ role: 'ADMIN' });
    const adminAgent = await signedInAgent(admin.email);
    const queue = await adminAgent.get('/api/admin/reviews');
    expect(queue.body.submissions.map((s: { id: string }) => s.id)).toEqual([body.id]);
    expect(queue.body.submissions[0].ownershipDeclaredAt).not.toBeNull();

    expect((await adminAgent.post(`/api/admin/reviews/projects/${body.id}/approve`)).status).toBe(200);
    const feed = await request(app).get('/api/projects/feed');
    expect(feed.body.items.map((c: { id: string }) => c.id)).toEqual([body.id]);

    const log = await prisma.auditLog.findMany({ where: { targetId: body.id }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => l.action)).toEqual(['PROJECT_CREATED', 'PROJECT_SUBMITTED', 'PROJECT_APPROVED']);
  });

  it('returns the Admin note when changes are requested, and allows resubmission', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send(COMPLETE_PROJECT);
    await agent.post(`/api/projects/${body.id}/submit`).send({ ownershipDeclared: true });

    const admin = await createUser({ role: 'ADMIN' });
    const adminAgent = await signedInAgent(admin.email);
    const res = await adminAgent.post(`/api/admin/reviews/projects/${body.id}/request-changes`).send({ note: 'Add a working demo link.' });
    expect(res.status).toBe(200);

    const ws = await agent.get(`/api/projects/${body.id}/workspace`);
    expect(ws.body.project.status).toBe('CHANGES_REQUESTED');
    expect(ws.body.project.reviewNote).toBe('Add a working demo link.');

    expect((await agent.patch(`/api/projects/${body.id}`).send({ demoUrl: 'https://demo.example.com/v2' })).status).toBe(200);
    expect((await agent.post(`/api/projects/${body.id}/submit`).send({ ownershipDeclared: true })).status).toBe(200);
  });

  it('keeps the review queue Admin-only', async () => {
    const { agent } = await uploaderAgent();
    expect((await agent.get('/api/admin/reviews')).status).toBe(403);
  });
});

describe('Optional screenshots', () => {
  it('stores PNG screenshots and rejects other or disguised files', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send({ title: 'With screenshots' });

    const ok = await agent.post(`/api/projects/${body.id}/media`).attach('screenshots', PNG_BYTES, { filename: 'a.png', contentType: 'image/png' });
    expect(ok.status).toBe(201);
    expect(ok.body.media).toHaveLength(1);
    expect(storage.objects.size).toBe(1);

    const pdf = await agent.post(`/api/projects/${body.id}/media`).attach('screenshots', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(400);

    const fake = await agent.post(`/api/projects/${body.id}/media`).attach('screenshots', Buffer.from('not really a png'), { filename: 'b.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('INVALID_FILE');
  });

  it('rejects screenshots over 2 MB', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send({ title: 'Big screenshot' });
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await agent.post(`/api/projects/${body.id}/media`).attach('screenshots', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });
});

describe('Optional cover image', () => {
  const attachCover = (agent: Awaited<ReturnType<typeof uploaderAgent>>['agent'], id: string, data = PNG_BYTES) =>
    agent.post(`/api/projects/${id}/cover`).attach('cover', data, { filename: 'cover.png', contentType: 'image/png' });

  it('sets, replaces and removes the cover, keeping one stored file', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send({ title: 'With a cover' });

    const first = await attachCover(agent, body.id);
    expect(first.status).toBe(201);
    expect(first.body.project.thumbnailUrl).toMatch(new RegExp(`projects/${body.id}/cover-`));

    const second = await attachCover(agent, body.id);
    expect(second.body.project.thumbnailUrl).not.toBe(first.body.project.thumbnailUrl);
    expect(coverStorage.objects.size).toBe(1);

    const removed = await agent.delete(`/api/projects/${body.id}/cover`);
    expect(removed.status).toBe(200);
    expect(removed.body.project.thumbnailUrl).toBeNull();
    expect(coverStorage.objects.size).toBe(0);
  });

  it('rejects a disguised file and other users', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send({ title: 'Cover checks' });

    const fake = await attachCover(agent, body.id, Buffer.from('not really a png'));
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('INVALID_FILE');

    const other = await uploaderAgent();
    expect((await attachCover(other.agent, body.id)).status).toBe(404);
    expect(coverStorage.objects.size).toBe(0);
  });

  it('lets the team change images on a live project, but not while it is in review', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send(COMPLETE_PROJECT);
    const screenshot = () => agent.post(`/api/projects/${body.id}/media`).attach('screenshots', PNG_BYTES, { filename: 'a.png', contentType: 'image/png' });

    await prisma.project.update({ where: { id: body.id }, data: { status: 'SUBMITTED' } });
    expect((await screenshot()).body.error.code).toBe('MEDIA_LOCKED');
    expect((await attachCover(agent, body.id)).body.error.code).toBe('MEDIA_LOCKED');

    for (const status of ['PUBLISHED', 'HIDDEN']) {
      await prisma.project.update({ where: { id: body.id }, data: { status, publishedAt: new Date() } });
      expect({ status, screenshot: (await screenshot()).status, cover: (await attachCover(agent, body.id)).status }).toEqual({ status, screenshot: 201, cover: 201 });
    }
    const [first] = await prisma.projectMedia.findMany({ where: { projectId: body.id } });
    expect((await agent.delete(`/api/projects/${body.id}/media/${first.id}`)).status).toBe(204);
    expect(await prisma.projectMedia.count({ where: { projectId: body.id } })).toBe(1);

    await prisma.project.update({ where: { id: body.id }, data: { status: 'REMOVED' } });
    expect((await screenshot()).body.error.code).toBe('MEDIA_LOCKED');
  });

  it('shows the cover to Guests on the published card', async () => {
    const { agent } = await uploaderAgent();
    const { body } = await agent.post('/api/projects').send(COMPLETE_PROJECT);
    const { body: ws } = await attachCover(agent, body.id);
    await prisma.project.update({ where: { id: body.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });

    const feed = await request(app).get('/api/projects/feed');
    expect(feed.body.items[0].thumbnailUrl).toBe(ws.project.thumbnailUrl);
  });
});
