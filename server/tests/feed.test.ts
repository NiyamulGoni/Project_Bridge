/**
 * Feed skeleton (early slice of AT05/AT07): role-specific fields and the Guest cap.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createUser, prisma, request, resetDb, signedInAgent } from './helpers.js';

const LONG_SUMMARY = 'S'.repeat(300);
const LONG_OVERVIEW = 'O'.repeat(1200);

async function seedProjects(count: number) {
  const owner = await createUser();
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    await prisma.project.create({
      data: {
        ownerId: owner.id,
        title: `Project ${i + 1}`,
        summary: LONG_SUMMARY,
        overview: LONG_OVERVIEW,
        tags: ['web', 'ml'],
        stage: 'PROTOTYPE',
        status: 'PUBLISHED',
        publishedAt: new Date(now - i * 1000),
      },
    });
  }
  return owner;
}

beforeEach(resetDb);

describe('Feed visibility by viewer tier', () => {
  it('gives a Guest only the title, tags, thumbnail and a 150-character summary', async () => {
    await seedProjects(3);
    const res = await request(app).get('/api/projects/feed');

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('GUEST');
    const card = res.body.items[0];
    expect(card.summary.length).toBeLessThanOrEqual(150);
    expect(card.overview).toBeUndefined();
    expect(card.owner).toBeUndefined();
    expect(card.tags).toEqual(['web', 'ml']);
  });

  it('gives an Uploader at most 500 characters of the overview', async () => {
    await seedProjects(1);
    const uploader = await createUser({ role: 'UPLOADER' });
    const res = await (await signedInAgent(uploader.email)).get('/api/projects/feed');

    expect(res.body.tier).toBe('UPLOADER');
    expect(res.body.items[0].overview.length).toBeLessThanOrEqual(500);
    expect(res.body.items[0].owner).toBeUndefined();
  });

  it('gives a Professional the full overview and owner name', async () => {
    await seedProjects(1);
    const pro = await createUser({ role: 'PROFESSIONAL' });
    const res = await (await signedInAgent(pro.email)).get('/api/projects/feed');

    expect(res.body.tier).toBe('PROFESSIONAL');
    expect(res.body.items[0].overview).toBe(LONG_OVERVIEW);
    expect(res.body.items[0].owner.name).toBeDefined();
  });

  it('excludes projects that are not published', async () => {
    const owner = await seedProjects(2);
    for (const status of ['DRAFT', 'HIDDEN', 'REMOVED']) {
      await prisma.project.create({
        data: { ownerId: owner.id, title: status, summary: 's', overview: 'o', stage: 'IDEA', status },
      });
    }
    const res = await request(app).get('/api/projects/feed');
    expect(res.body.items.map((c: { title: string }) => c.title)).toEqual(['Project 1', 'Project 2']);
  });
});

describe('Guest 20-card cap', () => {
  it('serves 20 cards over two pages, then blocks the 21st with a sign-in prompt', async () => {
    await seedProjects(30);
    const guest = request.agent(app);

    const page1 = await guest.get('/api/projects/feed?page=1');
    expect(page1.body.items).toHaveLength(10);
    expect(page1.body.hasMore).toBe(true);

    const page2 = await guest.get('/api/projects/feed?page=2');
    expect(page2.body.items).toHaveLength(10);
    expect(page2.body.hasMore).toBe(false);
    expect(page2.body.guest).toMatchObject({ limit: 20, cardsServed: 20, capReached: true });

    const page3 = await guest.get('/api/projects/feed?page=3');
    expect(page3.status).toBe(403);
    expect(page3.body.error.code).toBe('GUEST_LIMIT');
  });

  it('does not show the sign-in prompt when nothing lies beyond the cards served', async () => {
    await seedProjects(20);
    const guest = request.agent(app);

    await guest.get('/api/projects/feed?page=1');
    const page2 = await guest.get('/api/projects/feed?page=2');
    expect(page2.body.items).toHaveLength(10);
    expect(page2.body.hasMore).toBe(false);
    expect(page2.body.guest).toMatchObject({ limit: 20, cardsServed: 20, capReached: false });
  });

  it('applies the cap even to a direct request without a guest cookie', async () => {
    await seedProjects(30);
    const res = await request(app).get('/api/projects/feed?page=3');
    expect(res.status).toBe(403);
  });

  it('does not cap signed-in users', async () => {
    await seedProjects(30);
    const uploader = await createUser();
    const res = await (await signedInAgent(uploader.email)).get('/api/projects/feed?page=3');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(10);
  });
});
