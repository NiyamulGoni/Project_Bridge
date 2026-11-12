/**
 * Step 8 / FR10 part 2: private messages. Only the two participants read or send; the body is stored encrypted.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/lib/crypto.js';
import { app, createProject, createUser, prisma, request, resetDb, signedInAgent } from './helpers.js';
import { expectCleanResponse } from './responseScan.js';

beforeEach(resetDb);

const agentFor = async (role: string, status = 'ACTIVE') => {
  const user = await createUser({ role, status });
  return { user, agent: await signedInAgent(user.email) };
};

/** An Uploader and a Professional with an open conversation about the Uploader's project. */
async function talking() {
  const a = await agentFor('UPLOADER');
  const b = await agentFor('PROFESSIONAL');
  const project = await createProject(a.user.id);
  const contact = await prisma.contactRequest.create({
    data: { senderId: b.user.id, recipientId: a.user.id, projectId: project.id, introduction: encrypt('Hello, I would like to talk.', 'ContactRequest.introduction'), status: 'ACCEPTED' },
  });
  const conversation = await prisma.conversation.create({
    data: { contactRequestId: contact.id, participants: { create: [{ userId: a.user.id }, { userId: b.user.id }] } },
  });
  return { a, b, project, id: conversation.id, url: `/api/messaging/conversations/${conversation.id}/messages` };
}

describe('Sending and reading', () => {
  it('stores the body encrypted, and both participants read it', async () => {
    const { a, b, url } = await talking();
    const text = 'Can we meet on Thursday to see the prototype?';
    const sent = await a.agent.post(url).send({ body: text });
    expect(sent.status).toBe(201);

    const stored = await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } });
    expect(stored.body).not.toContain('Thursday');
    expect(decrypt(stored.body, 'Message.body')).toBe(text);

    const read = await b.agent.get(url);
    expect(read.body.items).toHaveLength(1);
    expect(read.body.items[0]).toMatchObject({ body: text, mine: false });
    expect(read.body.with).toEqual({ id: a.user.id, name: a.user.name });
    expectCleanResponse(read.body, { values: [a.user.email, b.user.email] });
  });

  it('notifies the other person once until they read the notice', async () => {
    const { a, b, url } = await talking();
    await a.agent.post(url).send({ body: 'First message.' });
    await a.agent.post(url).send({ body: 'Second message.' });
    expect(await prisma.notification.count({ where: { recipientId: b.user.id, eventType: 'NEW_MESSAGE' } })).toBe(1);
  });

  it('refuses an empty or oversized message', async () => {
    const { a, url } = await talking();
    expect((await a.agent.post(url).send({ body: '  ' })).status).toBe(400);
    expect((await a.agent.post(url).send({ body: 'x'.repeat(2001) })).status).toBe(400);
  });

  it('pages backwards with a cursor', async () => {
    const { a, id, url } = await talking();
    const start = Date.now() - 100_000;
    await prisma.message.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({ conversationId: id, senderId: a.user.id, body: encrypt(`Message ${i}`, 'Message.body'), createdAt: new Date(start + i * 1000) })),
    });
    const first = await a.agent.get(url);
    expect(first.body.items).toHaveLength(30);
    expect(first.body.items[0].body).toBe('Message 34');
    const second = await a.agent.get(`${url}?cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((m: { body: string }) => m.body)).toEqual(['Message 4', 'Message 3', 'Message 2', 'Message 1', 'Message 0']);
    expect(second.body.nextCursor).toBeNull();
    expect((await a.agent.get(`${url}?cursor=not-a-message`)).status).toBe(400);
  });
});

describe('Who may read and send', () => {
  it('non-participants get 404, Admins included, and a Guest gets 401', async () => {
    const { a, url } = await talking();
    await a.agent.post(url).send({ body: 'Private words.' });
    for (const role of ['UPLOADER', 'PROFESSIONAL']) {
      const { agent } = await agentFor(role);
      expect((await agent.get(url)).status).toBe(404);
      expect((await agent.post(url).send({ body: 'Let me in.' })).status).toBe(404);
      expect((await agent.get('/api/messaging/conversations')).body.items).toEqual([]);
    }
    const { agent: admin } = await agentFor('ADMIN');
    expect((await admin.get(url)).status).toBe(404);
    // Admins may never message, so the role gate refuses the send first, whatever the id.
    expect((await admin.post(url).send({ body: 'Let me in.' })).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
    expect(await prisma.message.count()).toBe(1);
  });

  it('a RESTRICTED participant can read but not send', async () => {
    const { a, b, url } = await talking();
    await a.agent.post(url).send({ body: 'Are you there?' });
    await prisma.user.update({ where: { id: b.user.id }, data: { status: 'RESTRICTED' } });
    expect((await b.agent.get(url)).body.items).toHaveLength(1);
    const refused = await b.agent.post(url).send({ body: 'Yes.' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ACCOUNT_RESTRICTED');
  });

  it('a suspended or banned participant loses access, and cannot be written to', async () => {
    const { a, b, url } = await talking();
    await prisma.user.update({ where: { id: b.user.id }, data: { status: 'SUSPENDED' } });
    expect((await b.agent.get(url)).status).toBe(401);
    expect((await a.agent.post(url).send({ body: 'Hello?' })).status).toBe(409);
  });

  it('the conversation survives its project being hidden or deleted', async () => {
    const { a, b, project, id, url } = await talking();
    const listed = (await a.agent.get('/api/messaging/conversations')).body.items;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id, with: { name: b.user.name }, project: { id: project.id } });

    for (const status of ['HIDDEN', 'DELETED']) {
      await prisma.project.update({ where: { id: project.id }, data: { status } });
      expect((await b.agent.post(url).send({ body: `Still here after ${status}.` })).status).toBe(201);
      expect((await a.agent.get('/api/messaging/conversations')).body.items[0].project).toBeNull();
    }
    expect((await a.agent.get(url)).body.items).toHaveLength(2);
  });
});
