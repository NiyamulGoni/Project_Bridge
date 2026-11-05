/**
 * AT07 / FR07: the role-specific project view (proposal Section 4.2), enforced on direct requests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createProject, createUser, PNG_BYTES, prisma, request, resetDb, signedInAgent, storage } from './helpers.js';

beforeEach(resetDb);

const LONG_OVERVIEW = 'O'.repeat(1200);

async function richProject(overrides: Record<string, unknown> = {}) {
  const owner = await createUser();
  const project = await createProject(owner.id, { summary: 'S'.repeat(190), overview: LONG_OVERVIEW, ...overrides });
  const editor = await createUser();
  await prisma.projectMember.create({ data: { projectId: project.id, userId: editor.id, status: 'ACCEPTED', invitedById: owner.id } });
  await prisma.milestone.create({ data: { projectId: project.id, title: 'Pilot', status: 'IN_PROGRESS' } });
  await prisma.progressEntry.create({ data: { projectId: project.id, authorId: owner.id, body: 'Week 3 update' } });
  await prisma.projectMedia.create({ data: { projectId: project.id, storagePath: `projects/${project.id}/a.png`, mimeType: 'image/png', sizeBytes: PNG_BYTES.length } });
  await storage.upload(`projects/${project.id}/a.png`, PNG_BYTES, 'image/png');
  return { owner, editor, project };
}

async function viewAs(role: string | null, id: string) {
  if (!role) return request(app).get(`/api/projects/${id}`);
  const user = await createUser({ role });
  return (await signedInAgent(user.email)).get(`/api/projects/${id}`);
}

describe('Guest view', () => {
  it('shows only title, tags, stage, thumbnail and a 150-character summary', async () => {
    const { project } = await richProject({ publicDemo: true });
    const res = await viewAs(null, project.id);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('GUEST');
    const p = res.body.project;
    expect(p.summary.length).toBeLessThanOrEqual(150);
    for (const hidden of ['overview', 'problem', 'demoUrl', 'screenshots', 'team', 'owner', 'milestones', 'progress']) {
      expect(p[hidden]).toBeUndefined();
    }
  });

  it('counts direct opens against the 20-project guest cap', async () => {
    const owner = await createUser();
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) ids.push((await createProject(owner.id)).id);
    const guest = request.agent(app);
    for (const id of ids.slice(0, 20)) expect((await guest.get(`/api/projects/${id}`)).status).toBe(200);
    // Reopening an already-seen project is fine; a 21st new one is not.
    expect((await guest.get(`/api/projects/${ids[0]}`)).status).toBe(200);
    const blocked = await guest.get(`/api/projects/${ids[20]}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('GUEST_LIMIT');
  });

  it('lets a guest open cards already shown in the feed after reaching the cap', async () => {
    const owner = await createUser();
    for (let i = 0; i < 25; i++) await createProject(owner.id, { publishedAt: new Date(Date.now() - i * 1000) });
    const guest = request.agent(app);
    const page1 = await guest.get('/api/projects/feed?page=1');
    await guest.get('/api/projects/feed?page=2');
    expect((await guest.get(`/api/projects/${page1.body.items[0].id}`)).status).toBe(200);
  });
});

describe('Uploader view', () => {
  it('adds 500 characters of overview but no demo material unless the owner made it public', async () => {
    const { project } = await richProject({ publicDemo: false });
    const p = (await viewAs('UPLOADER', project.id)).body.project;
    expect(p.overview.length).toBeLessThanOrEqual(500);
    expect(p.summary.length).toBeLessThanOrEqual(150);
    for (const hidden of ['problem', 'demoUrl', 'screenshots', 'team', 'owner', 'milestones', 'progress']) {
      expect(p[hidden]).toBeUndefined();
    }
  });

  it('includes owner-designated public demo material', async () => {
    const { project } = await richProject({ publicDemo: true });
    const p = (await viewAs('UPLOADER', project.id)).body.project;
    expect(p.demoUrl).toBe(project.demoUrl);
    expect(p.screenshots).toHaveLength(1);
    expect(p.problem).toBeUndefined();
  });
});

describe('Professional view', () => {
  it('shows the full overview, demo, progress and team by name, without contact details', async () => {
    const { project, owner, editor } = await richProject({ publicDemo: false });
    const res = await viewAs('PROFESSIONAL', project.id);
    const p = res.body.project;
    expect(res.body.tier).toBe('PROFESSIONAL');
    expect(p.overview).toBe(LONG_OVERVIEW);
    expect(p.problem).toBe(project.problem);
    expect(p.demoUrl).toBe(project.demoUrl);
    expect(p.screenshots[0].url).toContain('signed');
    expect(p.milestones).toEqual([expect.objectContaining({ title: 'Pilot', status: 'IN_PROGRESS' })]);
    expect(p.progress[0].body).toBe('Week 3 update');
    expect(p.team).toEqual([
      { name: owner.name, role: 'OWNER' },
      { name: editor.name, role: 'EDITOR' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('@example.com');
  });
});

describe('Direct requests', () => {
  it('returns 404 for drafts, submissions, hidden, removed, deleted and unknown projects', async () => {
    const owner = await createUser();
    for (const status of ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'HIDDEN', 'REMOVED', 'DELETED']) {
      const p = await createProject(owner.id, { status });
      expect((await viewAs('PROFESSIONAL', p.id)).status).toBe(404);
    }
    expect((await viewAs('PROFESSIONAL', 'does-not-exist')).status).toBe(404);
  });
});
