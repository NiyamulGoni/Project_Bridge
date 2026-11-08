/**
 * Step 6 / FR08, FR09: likes and comments, for active Professionals only, shown in the Professional view only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createProject, createUser, prisma, request, resetDb, signedInAgent } from './helpers.js';
import { expectCleanResponse } from './responseScan.js';

beforeEach(resetDb);

const agentFor = async (role: string, status = 'ACTIVE') => {
  const user = await createUser({ role, status });
  return { user, agent: await signedInAgent(user.email) };
};

async function setup() {
  const { user: owner, agent: ownerAgent } = await agentFor('UPLOADER');
  const project = await createProject(owner.id);
  const { user: pro, agent: proAgent } = await agentFor('PROFESSIONAL');
  return { owner, ownerAgent, project, pro, proAgent };
}

describe('Likes', () => {
  it('a double like counts once, and unliking twice is not an error', async () => {
    const { project, proAgent } = await setup();
    const url = `/api/projects/${project.id}/like`;
    expect((await proAgent.put(url)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await proAgent.put(url)).body).toEqual({ liked: true, likeCount: 1 });
    expect(await prisma.projectLike.count()).toBe(1);
    expect((await proAgent.delete(url)).body).toEqual({ liked: false, likeCount: 0 });
    expect((await proAgent.delete(url)).body).toEqual({ liked: false, likeCount: 0 });
  });

  it('the database itself refuses a second like by the same user', async () => {
    const { project, pro } = await setup();
    await prisma.projectLike.create({ data: { projectId: project.id, userId: pro.id } });
    await expect(prisma.projectLike.create({ data: { projectId: project.id, userId: pro.id } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('only published projects can be liked', async () => {
    const { owner, proAgent } = await setup();
    const draft = await createProject(owner.id, { status: 'DRAFT', publishedAt: null });
    expect((await proAgent.put(`/api/projects/${draft.id}/like`)).status).toBe(404);
    expect((await proAgent.put('/api/projects/no-such-project/like')).status).toBe(404);
  });
});

describe('Who may like and comment', () => {
  const ROUTES = [
    ['put', 'like'],
    ['delete', 'like'],
    ['post', 'comments'],
  ] as const;

  it.each(ROUTES)('%s %s: Guests, Uploaders, Admins and RESTRICTED Professionals are denied', async (method, path) => {
    const { project } = await setup();
    const url = `/api/projects/${project.id}/${path}`;
    const body = { body: 'Great idea.' };
    expect((await request(app)[method](url).send(body)).status).toBe(401);
    expect((await (await agentFor('UPLOADER')).agent[method](url).send(body)).status).toBe(403);
    expect((await (await agentFor('ADMIN')).agent[method](url).send(body)).status).toBe(403);
    const restricted = await (await agentFor('PROFESSIONAL', 'RESTRICTED')).agent[method](url).send(body);
    expect(restricted.status).toBe(403);
    expect(restricted.body.error.code).toBe('ACCOUNT_RESTRICTED');
    expect(await prisma.projectLike.count()).toBe(0);
    expect(await prisma.comment.count()).toBe(0);
  });
});

describe('Comments', () => {
  it('HTML comes back exactly as typed, as plain JSON text, not interpreted', async () => {
    const { project, proAgent } = await setup();
    const html = '<script>alert("hi")</script><b>bold</b> & <img src=x onerror=alert(1)>';
    const res = await proAgent.post(`/api/projects/${project.id}/comments`).send({ body: html });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.comment.body).toBe(html);

    const view = await (await agentFor('PROFESSIONAL')).agent.get(`/api/projects/${project.id}`);
    expect(view.headers['content-type']).toMatch(/^application\/json/);
    expect(view.body.project.comments[0].body).toBe(html);
  });

  it('must be 1 to 500 characters, on a published project', async () => {
    const { owner, project, proAgent } = await setup();
    const url = `/api/projects/${project.id}/comments`;
    expect((await proAgent.post(url).send({ body: '   ' })).status).toBe(400);
    expect((await proAgent.post(url).send({ body: 'x'.repeat(501) })).status).toBe(400);
    expect((await proAgent.post(url).send({ body: 'x'.repeat(500) })).status).toBe(201);
    const hidden = await createProject(owner.id, { status: 'HIDDEN' });
    expect((await proAgent.post(`/api/projects/${hidden.id}/comments`).send({ body: 'Hello' })).status).toBe(404);
  });

  it('only the author edits or deletes', async () => {
    const { project, proAgent } = await setup();
    const { body } = await proAgent.post(`/api/projects/${project.id}/comments`).send({ body: 'First thought.' });
    const url = `/api/projects/${project.id}/comments/${body.comment.id}`;
    const { agent: other } = await agentFor('PROFESSIONAL');

    expect((await other.patch(url).send({ body: 'Hijacked.' })).status).toBe(403);
    expect((await other.delete(url)).status).toBe(403);
    expect((await proAgent.patch(`/api/projects/other-project/comments/${body.comment.id}`).send({ body: 'x' })).status).toBe(404);

    const edited = await proAgent.patch(url).send({ body: 'Second thought.' });
    expect(edited.status).toBe(200);
    expect(edited.body.comment.body).toBe('Second thought.');
    expect((await proAgent.delete(url)).status).toBe(200);
    expect(await prisma.comment.count()).toBe(0);
  });

  it('notifies the project owner', async () => {
    const { owner, project, pro, proAgent } = await setup();
    await proAgent.post(`/api/projects/${project.id}/comments`).send({ body: 'Interesting.' });
    const notice = await prisma.notification.findFirstOrThrow({ where: { recipientId: owner.id } });
    expect(notice).toMatchObject({ eventType: 'PROJECT_COMMENTED', targetId: project.id });
    expect(notice.message).toContain(pro.name);
  });
});

describe('Professional tier only', () => {
  it('Professionals see counts on cards and comments in the view; Guests and Uploaders see neither', async () => {
    const { owner, ownerAgent, project, pro, proAgent } = await setup();
    await proAgent.put(`/api/projects/${project.id}/like`);
    await proAgent.post(`/api/projects/${project.id}/comments`).send({ body: 'Count me in.' });

    const card = (await proAgent.get('/api/projects/feed')).body.items.find((c: { id: string }) => c.id === project.id);
    expect(card).toMatchObject({ likeCount: 1, commentCount: 1 });
    const detail = (await proAgent.get(`/api/projects/${project.id}`)).body.project;
    expect(detail.likedByMe).toBe(true);
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0]).toMatchObject({ body: 'Count me in.', author: { id: pro.id, name: pro.name }, mine: true });
    expectCleanResponse(detail, { values: [pro.email, owner.email] });

    for (const agent of [request.agent(app), ownerAgent]) {
      const feedCard = (await agent.get('/api/projects/feed')).body.items.find((c: { id: string }) => c.id === project.id);
      expect(feedCard).not.toHaveProperty('likeCount');
      const view = (await agent.get(`/api/projects/${project.id}`)).body.project;
      expect(view).not.toHaveProperty('comments');
      expect(view).not.toHaveProperty('likeCount');
    }
  });
});
