/**
 * Step 9 / FR11: paid offers. Posted by Professionals on their own projects, reviewed by an Admin,
 * and shown only to the Professional and Admin tiers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createProject, createUser, prisma, request, resetDb, signedInAgent } from './helpers.js';

beforeEach(resetDb);

const agentFor = async (role: string, status = 'ACTIVE') => {
  const user = await createUser({ role, status });
  return { user, agent: await signedInAgent(user.email) };
};

const TERMS = { title: 'Embedded firmware developer', skills: ['C', 'RTOS'], type: 'FIXED', compensation: '25000', currency: 'bdt', applicationRoute: 'Send a short note about a device you have built.' };
const INTRO = 'I have shipped two sensor boards and would like to apply.';

async function setup() {
  const owner = await agentFor('PROFESSIONAL');
  const project = await createProject(owner.user.id);
  const admin = await agentFor('ADMIN');
  return { owner, project, admin };
}
async function approvedOffer() {
  const s = await setup();
  const { body } = await s.owner.agent.post('/api/offers').send({ ...TERMS, projectId: s.project.id });
  expect((await s.admin.agent.post(`/api/admin/offers/${body.offer.id}/approve`)).status).toBe(200);
  return { ...s, offerId: body.offer.id as string };
}
const detail = async (agent: ReturnType<typeof request.agent>, projectId: string) => (await agent.get(`/api/projects/${projectId}`)).body.project;

describe('Posting an offer', () => {
  it('waits for Admin review, then is visible with a no-payments notice', async () => {
    const { owner, project, admin } = await setup();
    const created = await owner.agent.post('/api/offers').send({ ...TERMS, projectId: project.id });
    expect(created.status).toBe(201);
    expect(created.body.offer).toMatchObject({ reviewStatus: 'PENDING', currency: 'BDT', skills: ['c', 'rtos'] });

    const viewer = await agentFor('PROFESSIONAL');
    expect((await detail(viewer.agent, project.id)).offers).toEqual([]);
    expect((await admin.agent.get('/api/admin/offers')).body.items).toHaveLength(1);

    expect((await admin.agent.post(`/api/admin/offers/${created.body.offer.id}/approve`)).status).toBe(200);
    for (const agent of [viewer.agent, admin.agent]) {
      const [offer] = (await detail(agent, project.id)).offers;
      expect(offer).toMatchObject({ title: TERMS.title, compensation: '25000', status: 'OPEN' });
      expect(offer.paymentNotice).toMatch(/does not process payments/);
    }
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'OFFER_APPROVED' } })).toMatchObject({ actorId: admin.user.id, oldValue: 'PENDING', newValue: 'APPROVED' });
    expect(await prisma.notification.count({ where: { recipientId: owner.user.id, eventType: 'OFFER_APPROVED' } })).toBe(1);
  });

  it('Uploaders and Guests never receive offer fields', async () => {
    const { project } = await approvedOffer();
    const uploader = await agentFor('UPLOADER');
    for (const agent of [uploader.agent, request.agent(app)]) {
      const res = await agent.get(`/api/projects/${project.id}`);
      expect(res.body.project).not.toHaveProperty('offers');
      expect(JSON.stringify(res.body)).not.toContain('firmware');
      expect(JSON.stringify((await agent.get('/api/projects/feed')).body)).not.toContain('firmware');
    }
    expect((await uploader.agent.get('/api/offers/mine')).status).toBe(403);
  });

  it('is denied to Guests, Uploaders, Admins, RESTRICTED Professionals and Professionals off the team', async () => {
    const { project, admin } = await setup();
    const body = { ...TERMS, projectId: project.id };
    expect((await request(app).post('/api/offers').send(body)).status).toBe(401);
    expect((await (await agentFor('UPLOADER')).agent.post('/api/offers').send(body)).status).toBe(403);
    expect((await admin.agent.post('/api/offers').send(body)).status).toBe(403);
    expect((await (await agentFor('PROFESSIONAL', 'RESTRICTED')).agent.post('/api/offers').send(body)).status).toBe(403);
    expect((await (await agentFor('PROFESSIONAL')).agent.post('/api/offers').send(body)).status).toBe(404);
    expect(await prisma.paidOffer.count()).toBe(0);
  });

  it('requires every term, and a published project', async () => {
    const { owner, project } = await setup();
    for (const missing of ['title', 'skills', 'type', 'compensation', 'currency', 'applicationRoute']) {
      const body: Record<string, unknown> = { ...TERMS, projectId: project.id };
      delete body[missing];
      expect({ missing, status: (await owner.agent.post('/api/offers').send(body)).status }).toEqual({ missing, status: 400 });
    }
    const draft = await createProject(owner.user.id, { status: 'DRAFT', publishedAt: null });
    expect((await owner.agent.post('/api/offers').send({ ...TERMS, projectId: draft.id })).status).toBe(409);
  });

  it('a rejected offer stays hidden, and the author is told why', async () => {
    const { owner, project, admin } = await setup();
    const { body } = await owner.agent.post('/api/offers').send({ ...TERMS, projectId: project.id });
    expect((await admin.agent.post(`/api/admin/offers/${body.offer.id}/reject`).send({})).status).toBe(400);
    expect((await admin.agent.post(`/api/admin/offers/${body.offer.id}/reject`).send({ note: 'The pay is not stated clearly.' })).status).toBe(200);
    expect((await detail((await agentFor('PROFESSIONAL')).agent, project.id)).offers).toEqual([]);
    expect((await owner.agent.get('/api/offers/mine')).body.items[0]).toMatchObject({ reviewStatus: 'REJECTED', reviewNote: 'The pay is not stated clearly.' });
  });
});

describe('Answering and closing an offer', () => {
  it('a contact request from an offer reaches its author', async () => {
    const { owner, offerId } = await approvedOffer();
    const candidate = await agentFor('PROFESSIONAL');
    const res = await candidate.agent.post('/api/messaging/requests').send({ offerId, introduction: INTRO });
    expect(res.status).toBe(201);
    expect(await prisma.contactRequest.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ recipientId: owner.user.id, offerId });
    // Offers are invisible to Uploaders, so to them this one does not exist.
    expect((await (await agentFor('UPLOADER')).agent.post('/api/messaging/requests').send({ offerId, introduction: INTRO })).status).toBe(404);
  });

  it('only the author closes it, and a closed offer takes no new requests', async () => {
    const { owner, project, offerId } = await approvedOffer();
    const candidate = await agentFor('PROFESSIONAL');
    expect((await candidate.agent.post(`/api/offers/${offerId}/close`)).status).toBe(404);
    expect((await owner.agent.post(`/api/offers/${offerId}/close`)).status).toBe(200);

    const refused = await candidate.agent.post('/api/messaging/requests').send({ offerId, introduction: INTRO });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('OFFER_CLOSED');
    expect((await detail(candidate.agent, project.id)).offers).toEqual([]);
    expect(await prisma.contactRequest.count()).toBe(0);
  });
});
