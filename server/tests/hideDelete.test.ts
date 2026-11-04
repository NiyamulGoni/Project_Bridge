/**
 * AT04 / FR04: reversible hide, confirmed delete that removes content and media but keeps audit metadata.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isContactable } from '../src/modules/projects/access.js';
import { app, coverStorage, createProject, createUser, PNG_BYTES, prisma, request, resetDb, signedInAgent, storage } from './helpers.js';

beforeEach(resetDb);

async function setup() {
  const owner = await createUser();
  const project = await createProject(owner.id, { tags: ['solar'] });
  const viewer = await createUser({ role: 'PROFESSIONAL' });
  return { owner, project, ownerAgent: await signedInAgent(owner.email), viewerAgent: await signedInAgent(viewer.email) };
}

describe('Hide', () => {
  it('removes the project from feed, search and direct views, and restores it on unhide', async () => {
    const { project, ownerAgent, viewerAgent } = await setup();

    expect((await ownerAgent.post(`/api/projects/${project.id}/hide`)).status).toBe(200);
    expect((await request(app).get('/api/projects/feed')).body.items).toHaveLength(0);
    expect((await viewerAgent.get('/api/projects/search?tags=solar')).body.items).toHaveLength(0);
    expect((await viewerAgent.get(`/api/projects/${project.id}`)).status).toBe(404);
    expect(isContactable(await prisma.project.findUniqueOrThrow({ where: { id: project.id } }))).toBe(false);

    expect((await ownerAgent.post(`/api/projects/${project.id}/unhide`)).status).toBe(200);
    expect((await viewerAgent.get(`/api/projects/${project.id}`)).status).toBe(200);
  });

  it('cannot be done by anyone but the owner', async () => {
    const { project, viewerAgent } = await setup();
    expect((await viewerAgent.post(`/api/projects/${project.id}/hide`)).status).toBe(404);
  });
});

describe('Delete', () => {
  it('requires typing the exact title', async () => {
    const { project, ownerAgent } = await setup();
    const res = await ownerAgent.delete(`/api/projects/${project.id}`).send({ confirmTitle: 'wrong' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.confirmTitle).toBeDefined();
  });

  it('removes content, media and team data but keeps audit metadata', async () => {
    const owner = await createUser();
    const ownerAgent = await signedInAgent(owner.email);
    const { body } = await ownerAgent.post('/api/projects').send({ title: 'Short-lived project' });
    await ownerAgent.post(`/api/projects/${body.id}/media`).attach('screenshots', PNG_BYTES, { filename: 'a.png', contentType: 'image/png' });
    await ownerAgent.post(`/api/projects/${body.id}/cover`).attach('cover', PNG_BYTES, { filename: 'c.png', contentType: 'image/png' });
    await ownerAgent.post(`/api/projects/${body.id}/milestones`).send({ title: 'Something' });
    expect(storage.objects.size).toBe(1);
    expect(coverStorage.objects.size).toBe(1);

    const res = await ownerAgent.delete(`/api/projects/${body.id}`).send({ confirmTitle: 'Short-lived project' });
    expect(res.status).toBe(200);

    const row = await prisma.project.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({ status: 'DELETED', overview: '', demoUrl: null, tags: [] });
    expect(row.title).not.toContain('Short-lived');
    expect(storage.objects.size).toBe(0);
    expect(coverStorage.objects.size).toBe(0);
    expect(row.thumbnailUrl).toBeNull();
    expect(await prisma.projectMedia.count()).toBe(0);
    expect(await prisma.milestone.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { targetId: body.id, action: 'PROJECT_DELETED' } })).toBe(1);
    expect(isContactable(row)).toBe(false);

    // Gone everywhere, including for the owner.
    expect((await ownerAgent.get(`/api/projects/${body.id}/workspace`)).status).toBe(404);
    expect((await ownerAgent.get('/api/projects/mine')).body.items).toHaveLength(0);
  });

  it('cannot be done by an editor or a stranger', async () => {
    const { project, owner, viewerAgent } = await setup();
    const editor = await createUser();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: editor.id, status: 'ACCEPTED', invitedById: owner.id } });
    const editorAgent = await signedInAgent(editor.email);

    expect((await editorAgent.delete(`/api/projects/${project.id}`).send({ confirmTitle: project.title })).status).toBe(404);
    expect((await viewerAgent.delete(`/api/projects/${project.id}`).send({ confirmTitle: project.title })).status).toBe(404);
  });
});
