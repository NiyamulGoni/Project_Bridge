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

  it('lets a guest search by name and by tags, with Guest card fields only', async () => {
    await seed();
    const byName = await request(app).get('/api/projects/search?q=bus');
    expect(byName.status).toBe(200);
    expect(titles(byName)).toEqual(['Bus Fare Estimator', 'Smart Bus Tracker']);
    expect(byName.body.tier).toBe('GUEST');
    expect(byName.body.items[0].overview).toBeUndefined();
    expect(byName.body.items[0].owner).toBeUndefined();

    const byTags = await request(app).get('/api/projects/search?tags=transport,iot');
    expect(titles(byTags)).toEqual(['Smart Bus Tracker']);

    const both = await request(app).get('/api/projects/search?q=fare&tags=data');
    expect(titles(both)).toEqual(['Bus Fare Estimator']);
    expect(both.body.total).toBe(1);
  });

  it('shows a guest no hidden or draft projects, and a guest search is not logged', async () => {
    await seed();
    const res = await request(app).get('/api/projects/search?q=hidden');
    expect(res.body.items).toEqual([]);
    const { prisma } = await import('../src/lib/prisma.js');
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.searchLog.count()).toBe(0);
  });

  it('charges a guest search to the same 20-project budget as the feed', async () => {
    const owner = await createUser();
    for (let i = 1; i <= 30; i++) await createProject(owner.id, { title: `Gadget ${i}`, tags: ['gadget'] });
    const guest = request.agent(app);

    const p1 = await guest.get('/api/projects/search?q=gadget&page=1');
    const p2 = await guest.get('/api/projects/search?q=gadget&page=2');
    expect(p1.body.items).toHaveLength(10);
    expect(p2.body.items).toHaveLength(10);
    expect(p2.body.hasMore).toBe(false);
    expect(p2.body.total).toBe(30);
    expect(p2.body.guest).toMatchObject({ limit: 20, cardsServed: 20, capReached: true });

    const p3 = await guest.get('/api/projects/search?q=gadget&page=3');
    expect(p3.status).toBe(403);
    expect(p3.body.error.code).toBe('GUEST_LIMIT');

    // The budget is shared: the feed cannot show this guest any project beyond the 20 already seen.
    const feed = await guest.get('/api/projects/feed?page=1');
    expect(feed.body.items.length).toBeLessThanOrEqual(10);
    const seen = new Set([...p1.body.items, ...p2.body.items].map((i: { id: string }) => i.id));
    for (const card of feed.body.items) expect(seen.has(card.id)).toBe(true);
  });

  it('lets a guest list the tags in use', async () => {
    await seed();
    const res = await request(app).get('/api/projects/tags');
    expect(res.status).toBe(200);
    expect(res.body.items).toContainEqual({ tag: 'transport', count: 2 });
  });

  it('keeps live suggestions for signed-in users only', async () => {
    expect((await request(app).get('/api/projects/suggest?q=bus')).status).toBe(401);
  });

  it('lists tags in use for the tag chips', async () => {
    await seed();
    const res = await (await agentFor('UPLOADER')).get('/api/projects/tags');
    // 2, not 4: the hidden and draft projects' tags are not counted.
    expect(res.body.items).toContainEqual({ tag: 'transport', count: 2 });
  });
});
