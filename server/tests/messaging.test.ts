/**
 * Step 7 / FR10 part 1: contact requests. Accepting opens exactly one conversation; third parties get 404.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { decrypt } from '../src/lib/crypto.js';
import { app, createProject, createUser, prisma, request, resetDb, signedInAgent } from './helpers.js';
import { expectCleanResponse } from './responseScan.js';

beforeEach(resetDb);

const INTRO = 'Hi, I run a small agritech startup and would like to pilot this.';

const agentFor = async (role: string, status = 'ACTIVE') => {
  const user = await createUser({ role, status });
  return { user, agent: await signedInAgent(user.email) };
};

/** A Professional sends a request about an Uploader's project. */
async function sent() {
  const { user: owner, agent: ownerAgent } = await agentFor('UPLOADER');
  const project = await createProject(owner.id);
  const { user: sender, agent: senderAgent } = await agentFor('PROFESSIONAL');
  const res = await senderAgent.post('/api/messaging/requests').send({ projectId: project.id, introduction: INTRO });
  expect(res.status).toBe(201);
  return { owner, ownerAgent, project, sender, senderAgent, id: res.body.id as string };
}

describe('Sending a request', () => {
  it('reaches the project owner without exposing an email, with the introduction encrypted', async () => {
    const { owner, sender, id } = await sent();
    const stored = await prisma.contactRequest.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ senderId: sender.id, recipientId: owner.id, status: 'PENDING' });
    expect(stored.introduction).not.toContain('agritech');
    expect(decrypt(stored.introduction, 'ContactRequest.introduction')).toBe(INTRO);
    expect(await prisma.notification.count({ where: { recipientId: owner.id, eventType: 'CONTACT_REQUEST' } })).toBe(1);
  });

  it('can go straight to a user', async () => {
    const { user: target } = await agentFor('PROFESSIONAL');
    const { agent } = await agentFor('UPLOADER');
    const res = await agent.post('/api/messaging/requests').send({ userId: target.id, introduction: INTRO });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'status']);
  });

  it('is denied to Guests, Admins and RESTRICTED accounts', async () => {
    const { user: owner } = await agentFor('UPLOADER');
    const project = await createProject(owner.id);
    const body = { projectId: project.id, introduction: INTRO };
    expect((await request(app).post('/api/messaging/requests').send(body)).status).toBe(401);
    expect((await (await agentFor('ADMIN')).agent.post('/api/messaging/requests').send(body)).status).toBe(403);
    expect((await (await agentFor('PROFESSIONAL', 'RESTRICTED')).agent.post('/api/messaging/requests').send(body)).status).toBe(403);
  });

  it('refuses yourself, unpublished projects, unreachable owners and inactive users', async () => {
    const { user: me, agent } = await agentFor('PROFESSIONAL');
    const mine = await createProject(me.id);
    // These accounts only need to exist; a suspended one could not sign in anyway.
    const owner = await createUser({ role: 'UPLOADER' });
    const draft = await createProject(owner.id, { status: 'DRAFT', publishedAt: null });
    const restrictedOwner = await createUser({ role: 'UPLOADER', status: 'RESTRICTED' });
    const unreachable = await createProject(restrictedOwner.id);
    const suspended = await createUser({ role: 'PROFESSIONAL', status: 'SUSPENDED' });
    const admin = await createUser({ role: 'ADMIN' });
    const send = (body: object) => agent.post('/api/messaging/requests').send({ introduction: INTRO, ...body });

    expect((await send({ projectId: mine.id })).status).toBe(400);
    expect((await send({ userId: me.id })).status).toBe(400);
    expect((await send({ projectId: draft.id })).status).toBe(404);
    expect((await send({ projectId: unreachable.id })).status).toBe(409);
    expect((await send({ userId: suspended.id })).status).toBe(404);
    expect((await send({ userId: admin.id })).status).toBe(404);
    expect((await send({ projectId: owner.id, userId: owner.id })).status).toBe(400);
    expect((await send({ projectId: draft.id, introduction: 'hi' })).status).toBe(400);
    expect(await prisma.contactRequest.count()).toBe(0);
  });

  it('refuses a duplicate while pending, and allows a new one once it is answered', async () => {
    const { project, senderAgent, ownerAgent, id } = await sent();
    const again = await senderAgent.post('/api/messaging/requests').send({ projectId: project.id, introduction: INTRO });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REQUESTED');

    await ownerAgent.post(`/api/messaging/requests/${id}/decline`);
    expect((await prisma.contactRequest.findUniqueOrThrow({ where: { id } })).pendingKey).toBeNull();
    expect((await senderAgent.post('/api/messaging/requests').send({ projectId: project.id, introduction: INTRO })).status).toBe(201);
  });
});

describe('Answering a request', () => {
  it('accepting twice gives one conversation, with both people in it, and notifies the sender', async () => {
    const { owner, ownerAgent, sender, id } = await sent();
    const first = await ownerAgent.post(`/api/messaging/requests/${id}/accept`);
    expect(first.status).toBe(200);
    const second = await ownerAgent.post(`/api/messaging/requests/${id}/accept`);
    expect(second.status).toBe(409);

    const conversations = await prisma.conversation.findMany({ include: { participants: true } });
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe(first.body.conversationId);
    expect(conversations[0].participants.map((p) => p.userId).sort()).toEqual([owner.id, sender.id].sort());
    expect(await prisma.notification.count({ where: { recipientId: sender.id, eventType: 'CONTACT_ACCEPTED' } })).toBe(1);
  });

  it('two accepts at the same moment still give one conversation', async () => {
    const { ownerAgent, id } = await sent();
    const results = await Promise.all([ownerAgent.post(`/api/messaging/requests/${id}/accept`), ownerAgent.post(`/api/messaging/requests/${id}/accept`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('declining gives no conversation', async () => {
    const { ownerAgent, sender, id } = await sent();
    expect((await ownerAgent.post(`/api/messaging/requests/${id}/decline`)).body).toEqual({ status: 'DECLINED' });
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.notification.count({ where: { recipientId: sender.id, eventType: 'CONTACT_DECLINED' } })).toBe(1);
    expect((await ownerAgent.post(`/api/messaging/requests/${id}/accept`)).status).toBe(409);
  });

  it('only the recipient accepts or declines, and only the sender withdraws', async () => {
    const { ownerAgent, senderAgent, id } = await sent();
    expect((await senderAgent.post(`/api/messaging/requests/${id}/accept`)).status).toBe(404);
    expect((await senderAgent.post(`/api/messaging/requests/${id}/decline`)).status).toBe(404);
    expect((await ownerAgent.post(`/api/messaging/requests/${id}/withdraw`)).status).toBe(404);
    expect((await senderAgent.post(`/api/messaging/requests/${id}/withdraw`)).body).toEqual({ status: 'WITHDRAWN' });
    expect(await prisma.conversation.count()).toBe(0);
  });

  it('third parties get 404 and never see the request', async () => {
    const { id } = await sent();
    for (const role of ['UPLOADER', 'PROFESSIONAL', 'ADMIN']) {
      const { agent } = await agentFor(role);
      for (const action of ['accept', 'decline', 'withdraw']) {
        // Admins may not take part in conversations, so the role gate stops their accept first, whatever the id.
        const expected = role === 'ADMIN' && action === 'accept' ? 403 : 404;
        expect((await agent.post(`/api/messaging/requests/${id}/${action}`)).status).toBe(expected);
      }
      expect((await agent.get('/api/messaging/requests')).body.items).toEqual([]);
      expect((await agent.get('/api/messaging/requests?box=outgoing')).body.items).toEqual([]);
    }
    expect((await prisma.contactRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });
});

describe('Listing requests', () => {
  it('shows each side their own requests by name, with the introduction readable and no email', async () => {
    const { owner, ownerAgent, project, sender, senderAgent, id } = await sent();
    const incoming = await ownerAgent.get('/api/messaging/requests');
    expect(incoming.body.items).toHaveLength(1);
    expect(incoming.body.items[0]).toMatchObject({ id, status: 'PENDING', introduction: INTRO, from: { id: sender.id, name: sender.name }, project: { id: project.id, title: project.title } });
    expectCleanResponse(incoming.body, { values: [owner.email, sender.email] });

    const outgoing = await senderAgent.get('/api/messaging/requests?box=outgoing');
    expect(outgoing.body.items[0]).toMatchObject({ id, to: { id: owner.id, name: owner.name } });
    expect((await senderAgent.get('/api/messaging/requests')).body.items).toEqual([]);
    expect((await senderAgent.get('/api/messaging/requests?box=nope')).status).toBe(400);
  });
});
