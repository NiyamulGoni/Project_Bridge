/** Account page extras: the user's own cover photo and activity statistics. */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, coverStorage, createProject, createUser, PNG_BYTES, prisma, request, resetDb, signedInAgent } from './helpers.js';

beforeEach(resetDb);

describe('GET /api/auth/me/profile', () => {
  it('needs a signed-in user', async () => {
    expect((await request(app).get('/api/auth/me/profile')).status).toBe(401);
  });

  it('counts the user’s own projects and interactions since the account was created', async () => {
    const owner = await createUser();
    const pro = await createUser({ role: 'PROFESSIONAL' });
    const live = await createProject(owner.id);
    await createProject(owner.id, { status: 'DRAFT', publishedAt: null });
    await createProject(owner.id, { status: 'SUBMITTED', publishedAt: null });
    await createProject(owner.id, { status: 'DELETED' });
    const theirs = await createProject(pro.id);
    await prisma.projectMember.create({ data: { projectId: theirs.id, userId: owner.id, invitedById: pro.id, status: 'ACCEPTED' } });
    await prisma.projectLike.create({ data: { projectId: live.id, userId: pro.id } });
    await prisma.comment.createMany({ data: [{ projectId: live.id, authorId: pro.id, body: 'Nice work.' }, { projectId: live.id, authorId: owner.id, body: 'Thanks!' }] });

    const res = await (await signedInAgent(owner.email)).get('/api/auth/me/profile');

    expect(res.status).toBe(200);
    expect(res.body.coverUrl).toBeNull();
    expect(new Date(res.body.memberSince).getTime()).toBe(owner.createdAt.getTime());
    expect(res.body.stats).toEqual({
      projects: { uploaded: 3, published: 1, inReview: 1, drafts: 1, hidden: 0, removed: 0, team: 1 },
      likesReceived: 1,
      commentsReceived: 1,
      likesGiven: 0,
      commentsWritten: 1,
      contactRequestsSent: 0,
      contactRequestsReceived: 0,
      messagesSent: 0,
      offersPosted: 0,
    });
  });

  it('a RESTRICTED account can still read its profile', async () => {
    const user = await createUser({ status: 'RESTRICTED' });
    expect((await (await signedInAgent(user.email)).get('/api/auth/me/profile')).status).toBe(200);
  });
});

describe('Profile cover photo', () => {
  const upload = (agent: Awaited<ReturnType<typeof signedInAgent>>, bytes = PNG_BYTES, type = 'image/png') =>
    agent.post('/api/auth/me/cover').attach('cover', bytes, { filename: 'cover.png', contentType: type });

  it('uploads, replaces and removes the user’s own cover', async () => {
    const user = await createUser();
    const agent = await signedInAgent(user.email);

    const first = await upload(agent);
    expect(first.status).toBe(200);
    expect(first.body.coverUrl).toMatch(new RegExp(`^memory://users/${user.id}/cover-.+\\.png$`));
    expect((await agent.get('/api/auth/me/profile')).body.coverUrl).toBe(first.body.coverUrl);

    const second = await upload(agent);
    expect(second.body.coverUrl).not.toBe(first.body.coverUrl);
    expect([...coverStorage.objects.keys()]).toEqual([second.body.coverUrl.replace('memory://', '')]);

    expect((await agent.delete('/api/auth/me/cover')).status).toBe(204);
    expect(coverStorage.objects.size).toBe(0);
    expect((await agent.get('/api/auth/me/profile')).body.coverUrl).toBeNull();
    expect(await prisma.auditLog.count({ where: { targetId: user.id, action: { startsWith: 'PROFILE_COVER' } } })).toBe(3);
  });

  it('refuses a file that is not really an image', async () => {
    const agent = await signedInAgent((await createUser()).email);
    const res = await upload(agent, Buffer.from('not an image at all'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE');
    expect(coverStorage.objects.size).toBe(0);
  });

  it('refuses a declared type that is not an image', async () => {
    const agent = await signedInAgent((await createUser()).email);
    const res = await upload(agent, PNG_BYTES, 'application/pdf');
    expect(res.status).toBe(400);
    expect(coverStorage.objects.size).toBe(0);
  });

  it('refuses a request without a file', async () => {
    const agent = await signedInAgent((await createUser()).email);
    expect((await agent.post('/api/auth/me/cover')).status).toBe(400);
  });

  it('a RESTRICTED account cannot change its cover', async () => {
    const agent = await signedInAgent((await createUser({ status: 'RESTRICTED' })).email);
    const res = await upload(agent);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_RESTRICTED');
    expect((await agent.delete('/api/auth/me/cover')).status).toBe(403);
    expect(coverStorage.objects.size).toBe(0);
  });

  it('a Guest cannot upload a cover', async () => {
    const res = await request(app).post('/api/auth/me/cover').attach('cover', PNG_BYTES, { filename: 'c.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
    expect(coverStorage.objects.size).toBe(0);
  });

  it('one user’s cover never touches another’s', async () => {
    const alice = await signedInAgent((await createUser()).email);
    const bob = await signedInAgent((await createUser()).email);
    const aliceCover = (await upload(alice)).body.coverUrl;
    await bob.delete('/api/auth/me/cover');
    expect((await alice.get('/api/auth/me/profile')).body.coverUrl).toBe(aliceCover);
    expect((await bob.get('/api/auth/me/profile')).body.coverUrl).toBeNull();
  });
});
