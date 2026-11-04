/**
 * AT06 / FR06: case-insensitive name search combined with all selected tags.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createProject, createUser, request, resetDb, signedInAgent } from './helpers.js';

beforeEach(resetDb);

async function seed() {
  const owner = await createUser();
  await createProject(owner.id, { title: 'Smart Bus Tracker', tags: ['transport', 'iot'] });
  await createProject(owner.id, { title: 'Bus Fare Estimator', tags: ['transport', 'data'] });
  await createProject(owner.id, { title: 'Fair Grading Tool', tags: ['fair', 'education'] });
  await createProject(owner.id, { title: 'AI Tutor', tags: ['ai', 'education'] });
  await createProject(owner.id, { title: 'Hidden Bus', tags: ['transport'], status: 'HIDDEN' });
  await createProject(owner.id, { title: 'Draft Bus', tags: ['transport'], status: 'DRAFT' });
}

async function agentFor(role: string) {
  const user = await createUser({ role });
  return signedInAgent(user.email);
}

const titles = (res: { body: { items: Array<{ title: string }> } }) => res.body.items.map((i) => i.title).sort();

describe('Search', () => {
  it('matches project names case-insensitively and only among published projects', async () => {
    await seed();
    const agent = await agentFor('UPLOADER');
    const res = await agent.get('/api/projects/search?q=bUs');
    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Bus Fare Estimator', 'Smart Bus Tracker']);
  });

  it('requires every selected tag, matching whole tags only', async () => {
    await seed();
    const agent = await agentFor('UPLOADER');
    expect(titles(await agent.get('/api/projects/search?tags=transport,iot'))).toEqual(['Smart Bus Tracker']);
    expect(titles(await agent.get('/api/projects/search?tags=ai'))).toEqual(['AI Tutor']);
    expect(titles(await agent.get('/api/projects/search?tags=TRANSPORT'))).toEqual(['Bus Fare Estimator', 'Smart Bus Tracker']);
  });

  it('combines name text and tags', async () => {
    await seed();
    const agent = await agentFor('PROFESSIONAL');
    expect(titles(await agent.get('/api/projects/search?q=fare&tags=transport'))).toEqual(['Bus Fare Estimator']);
    const none = await agent.get('/api/projects/search?q=fare&tags=iot');
    expect(none.body.items).toEqual([]);
    expect(none.body.total).toBe(0);
  });

  it('paginates results', async () => {
    const owner = await createUser();
    for (let i = 0; i < 12; i++) await createProject(owner.id, { title: `Robot ${i}`, publishedAt: new Date(Date.now() - i * 1000) });
    const agent = await agentFor('UPLOADER');
    const p1 = await agent.get('/api/projects/search?q=robot');
    expect(p1.body).toMatchObject({ total: 12, hasMore: true });
    expect(p1.body.items).toHaveLength(10);
    const p2 = await agent.get('/api/projects/search?q=robot&page=2');
    expect(p2.body.items).toHaveLength(2);
    expect(p2.body.hasMore).toBe(false);
  });

  it('keeps the viewer’s detail limits', async () => {
    const owner = await createUser();
    await createProject(owner.id, { title: 'Long one', overview: 'O'.repeat(1200) });
    const uploader = await (await agentFor('UPLOADER')).get('/api/projects/search?q=long');
    expect(uploader.body.items[0].overview.length).toBeLessThanOrEqual(500);
    expect(uploader.body.items[0].owner).toBeUndefined();
    const pro = await (await agentFor('PROFESSIONAL')).get('/api/projects/search?q=long');
    expect(pro.body.items[0].overview).toHaveLength(1200);
  });

  it('is for signed-in users only', async () => {
    expect((await request(app).get('/api/projects/search?q=bus')).status).toBe(401);
  });

  it('lists tags in use for the tag chips', async () => {
    await seed();
    const res = await (await agentFor('UPLOADER')).get('/api/projects/tags');
    // 2, not 4: the hidden and draft projects' tags are not counted.
    expect(res.body.items).toContainEqual({ tag: 'transport', count: 2 });
  });
});
