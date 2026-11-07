/**
 * Step 4: in-app notifications. Everyone reaches only their own.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createProject, createUser, prisma, request, resetDb, signedInAgent } from './helpers.js';
import { expectCleanResponse } from './responseScan.js';

beforeEach(resetDb);

async function twoUsers() {
  const [alice, bob] = await Promise.all([createUser(), createUser()]);
  const notice = (recipientId: string, message: string) => prisma.notification.create({ data: { recipientId, eventType: 'TEST', message } });
  return { alice, bob, aliceAgent: await signedInAgent(alice.email), bobAgent: await signedInAgent(bob.email), notice };
}

describe('Reaching notifications', () => {
  it.each([
    ['get', '/api/notifications'],
    ['get', '/api/notifications/unread-count'],
    ['post', '/api/notifications/read-all'],
    ['post', '/api/notifications/some-id/read'],
  ] as const)('%s %s needs a session', async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401);
  });

  it('lists and counts only your own', async () => {
    const { alice, bob, aliceAgent, notice } = await twoUsers();
    const mine = await notice(alice.id, 'For Alice');
    await notice(bob.id, 'For Bob');

    const list = await aliceAgent.get('/api/notifications');
    expect(list.status).toBe(200);
    expect(list.body.items.map((n: { id: string }) => n.id)).toEqual([mine.id]);
    expect(Object.keys(list.body.items[0]).sort()).toEqual(['createdAt', 'eventType', 'id', 'isRead', 'message', 'targetId', 'targetType']);
    expectCleanResponse(list.body, { values: [bob.email, alice.email] });
    expect((await aliceAgent.get('/api/notifications/unread-count')).body).toEqual({ count: 1 });
  });

  it('marks your own as read', async () => {
    const { alice, aliceAgent, notice } = await twoUsers();
    const mine = await notice(alice.id, 'For Alice');
    expect((await aliceAgent.post(`/api/notifications/${mine.id}/read`)).status).toBe(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).isRead).toBe(true);
    expect((await aliceAgent.get('/api/notifications/unread-count')).body).toEqual({ count: 0 });
  });

  it('answers 404 for another user’s notification, exactly as for one that does not exist, and changes nothing', async () => {
    const { bob, aliceAgent, notice } = await twoUsers();
    const his = await notice(bob.id, 'For Bob');

    const theirs = await aliceAgent.post(`/api/notifications/${his.id}/read`);
    const missing = await aliceAgent.post('/api/notifications/no-such-id/read');
    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(missing.body);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: his.id } })).isRead).toBe(false);
  });

  it('mark all as read leaves other users alone', async () => {
    const { alice, bob, aliceAgent, notice } = await twoUsers();
    await notice(alice.id, 'One');
    await notice(alice.id, 'Two');
    const his = await notice(bob.id, 'For Bob');

    expect((await aliceAgent.post('/api/notifications/read-all')).status).toBe(200);
    expect(await prisma.notification.count({ where: { recipientId: alice.id, isRead: false } })).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: his.id } })).isRead).toBe(false);
  });

  it('pages through long lists', async () => {
    const { alice, aliceAgent } = await twoUsers();
    await prisma.notification.createMany({ data: Array.from({ length: 21 }, (_, i) => ({ recipientId: alice.id, eventType: 'TEST', message: `N${i}` })) });
    const first = await aliceAgent.get('/api/notifications');
    expect(first.body.items).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    const second = await aliceAgent.get('/api/notifications?page=2');
    expect(second.body.items).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);
    expect((await aliceAgent.get('/api/notifications?page=0')).status).toBe(400);
  });
});

describe('Team invitations', () => {
  it('notifies the invited person, and nobody else', async () => {
    const { alice, bob, aliceAgent, bobAgent } = await twoUsers();
    const project = await createProject(alice.id);

    expect((await aliceAgent.post(`/api/projects/${project.id}/members`).send({ email: bob.email })).status).toBe(201);

    const list = await bobAgent.get('/api/notifications');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ eventType: 'TEAM_INVITE', targetType: 'Project', targetId: project.id, isRead: false });
    expect(list.body.items[0].message).toContain(project.title);
    expect((await aliceAgent.get('/api/notifications')).body.items).toHaveLength(0);
  });
});
