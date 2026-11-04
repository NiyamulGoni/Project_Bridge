/**
 * Demo data. Every project here is synthetic (isSynthetic = true), kept separate from
 * genuine pilot projects as the proposal requires.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'Password123!';

const accounts = [
  { email: 'admin@projectbridge.test', name: 'Ayesha Admin', role: 'ADMIN', status: 'ACTIVE' },
  { email: 'pro@projectbridge.test', name: 'Farhan Professional', role: 'PROFESSIONAL', status: 'ACTIVE' },
  { email: 'uploader@projectbridge.test', name: 'Nusrat Uploader', role: 'UPLOADER', status: 'ACTIVE' },
  { email: 'banned@projectbridge.test', name: 'Bashir Banned', role: 'PROFESSIONAL', status: 'BANNED' },
];

const ideas: Array<[string, string, string]> = [
  ['Smart Campus Bus Tracker', 'transport,iot,mobile', 'Live location of DU campus buses so students stop waiting at stops for buses that already left.'],
  ['Bangla Handwriting OCR', 'ml,nlp,bangla', 'Recognises handwritten Bangla notes and turns them into searchable text for students.'],
  ['Clinic Queue Manager', 'health,web', 'Lets small clinics publish live queue numbers so patients wait at home instead of crowded rooms.'],
  ['Flood Alert SMS Network', 'disaster,sms,gis', 'Combines river-level data with SMS broadcasts to warn villages earlier before flash floods.'],
  ['Lab Equipment Booking', 'web,university', 'A booking calendar for shared lab equipment with conflict detection and usage history.'],
  ['Farm Price Board', 'agriculture,mobile,data', 'Daily wholesale prices from several markets so farmers can decide where to sell.'],
  ['Code Review Trainer', 'education,devtools', 'Practice code reviews on real bugs with instant feedback, built for second-year students.'],
  ['Blood Donor Finder', 'health,mobile,geo', 'Matches urgent blood requests with nearby verified donors while hiding personal numbers.'],
  ['Thesis Plagiarism Helper', 'nlp,education', 'Highlights passages that need citations before students submit their thesis drafts.'],
  ['Garment Line Balancer', 'industry,optimization', 'Suggests operator assignments to reduce bottlenecks on garment production lines.'],
  ['Accessible Campus Map', 'accessibility,gis,web', 'Shows ramps, lifts and accessible toilets across campus with step-free routes.'],
  ['Rickshaw Fare Estimator', 'transport,data', 'Estimates fair rickshaw fares from distance and time of day, using crowd-sourced trips.'],
  ['Exam Seat Planner', 'university,optimization', 'Generates exam seat plans that separate students of the same course automatically.'],
  ['Air Quality Dashboard', 'environment,iot,data', 'Low-cost sensors and a public dashboard for neighbourhood air quality in Dhaka.'],
  ['Freelancer Invoice Kit', 'fintech,web', 'Simple invoices and payment reminders for student freelancers working with foreign clients.'],
  ['Sign Language Tutor', 'accessibility,ml,education', 'Teaches basic Bangla Sign Language with webcam feedback on hand shapes.'],
  ['Library Seat Finder', 'iot,university', 'Shows free seats in the central library using desk sensors.'],
  ['Medicine Reminder Bot', 'health,chatbot', 'A messenger bot that reminds elderly patients to take medicine and alerts family when missed.'],
  ['Tuition Match', 'education,marketplace', 'Matches home tutors and families by subject, area and schedule with verified reviews.'],
  ['Waste Pickup Scheduler', 'environment,logistics', 'Lets residents request waste pickups and helps collectors plan efficient routes.'],
  ['Startup Pitch Analyzer', 'ml,business', 'Gives feedback on pitch decks: clarity, structure and missing sections.'],
  ['Hostel Meal Planner', 'university,web', 'Plans hostel meals from student votes and tracks budgets per month.'],
  ['Power Outage Map', 'energy,gis,crowdsourcing', 'Crowd-sourced map of load-shedding to help families plan their day.'],
  ['Legal Aid Navigator', 'legal,chatbot,bangla', 'Explains common legal processes in plain Bangla and points to free legal aid centres.'],
  ['Robotics Kit Inventory', 'robotics,university', 'Tracks borrowed robotics parts across clubs so kits come back complete.'],
  ['Mental Health Check-in', 'health,mobile', 'Anonymous weekly mood check-ins for students with links to campus counselling.'],
  ['Event Ticket Validator', 'web,security', 'QR tickets for university events that cannot be duplicated or reused.'],
  ['Crop Disease Detector', 'agriculture,ml,mobile', 'Photograph a leaf to detect common rice and jute diseases offline.'],
  ['Alumni Mentor Connect', 'education,networking', 'Connects current students with alumni mentors by career interest.'],
  ['Traffic Signal Simulator', 'transport,simulation', 'Simulates signal timing changes at busy Dhaka intersections before field trials.'],
];

const stages = ['IDEA', 'PROTOTYPE', 'MVP', 'PILOT', 'LAUNCHED'];

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** CC0 photos served by the web client from client/public/demo-covers (see the README there). */
function demoCover(title: string): string {
  return `/demo-covers/${slug(title)}.jpg`;
}

function problemFor(title: string, tags: string): string {
  return `Students and communities working on ${tags.split(',')[0]} problems still rely on manual, slow or fragmented tools. ${title} targets that gap with a focused, affordable solution built for local conditions.`;
}

function overviewFor(title: string, summary: string): string {
  return [
    `${title} started as a CSEDU semester project. ${summary}`,
    'The team interviewed potential users, built a first prototype and tested it with classmates. Feedback showed that the core workflow is useful but needs better onboarding and more reliable data sources.',
    'Current capabilities include account management, the main workflow end to end, and a simple analytics page for the team. The roadmap covers a pilot with real users, performance work for larger datasets, and an accessibility review.',
    'The team is looking for mentorship on deployment and scaling, feedback from industry practitioners in this domain, and possible paid contribution opportunities to continue development after the semester ends.',
  ].join('\n\n');
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users: Record<string, string> = {};
  for (const a of accounts) {
    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: { name: a.name, role: a.role, status: a.status, passwordHash },
      create: { ...a, passwordHash },
    });
    users[a.role === 'UPLOADER' ? 'uploader' : a.role === 'ADMIN' ? 'admin' : a.status === 'BANNED' ? 'banned' : 'pro'] = user.id;
  }

  // Related rows (revisions, milestones, progress, members, media rows) cascade.
  await prisma.project.deleteMany({ where: { isSynthetic: true } });
  const now = Date.now();
  const created: string[] = [];
  for (const [i, [title, tags, summary]] of ideas.entries()) {
    // Staggered timestamps give the feed a stable newest-first order.
    const at = new Date(now - i * 60 * 60 * 1000);
    const project = await prisma.project.create({
      data: {
        ownerId: i % 4 === 3 ? users.pro : users.uploader,
        title,
        summary,
        problem: problemFor(title, tags),
        overview: overviewFor(title, summary),
        tags: tags.split(','),
        stage: stages[i % stages.length],
        demoUrl: `https://demo.projectbridge.test/${slug(title)}`,
        thumbnailUrl: demoCover(title),
        publicDemo: i % 2 === 0,
        status: 'PUBLISHED',
        isSynthetic: true,
        ownershipDeclaredAt: at,
        submittedAt: at,
        publishedAt: at,
        createdAt: at,
        milestones: {
          create: [
            { title: 'User interviews', status: 'DONE', position: 0 },
            { title: 'Working prototype', status: i % 3 === 0 ? 'IN_PROGRESS' : 'DONE', position: 1 },
            { title: 'Pilot with real users', status: 'PLANNED', position: 2 },
          ],
        },
        progress: {
          create: [{ authorId: i % 4 === 3 ? users.pro : users.uploader, body: 'Finished usability testing with 12 classmates; fixing onboarding issues next.' }],
        },
      },
    });
    created.push(project.id);
  }

  // Review-queue demo data: one fresh submission and one pending revision.
  await prisma.project.create({
    data: {
      ownerId: users.uploader,
      title: 'Campus Lost & Found',
      summary: 'Report and claim lost items across campus with photo matching.',
      problem: 'Lost items on campus end up in scattered offices, and most are never returned to their owners.',
      overview: 'A shared lost-and-found board where finders post photos and locations, and owners claim items after answering a verification question set by the finder.',
      tags: ['web', 'university', 'ml'],
      stage: 'PROTOTYPE',
      demoUrl: 'https://demo.projectbridge.test/lost-and-found',
      thumbnailUrl: demoCover('Campus Lost & Found'),
      status: 'SUBMITTED',
      isSynthetic: true,
      ownershipDeclaredAt: new Date(),
      submittedAt: new Date(),
    },
  });
  const revised = await prisma.project.findUniqueOrThrow({ where: { id: created[0] } });
  await prisma.projectRevision.create({
    data: {
      projectId: revised.id,
      authorId: revised.ownerId,
      title: revised.title,
      summary: revised.summary,
      problem: revised.problem,
      overview: `${revised.overview}

Update: the pilot now covers three bus routes and shares live arrival estimates.`,
      tags: revised.tags,
      demoUrl: revised.demoUrl,
    },
  });

  console.log(`Seeded ${accounts.length} accounts, ${ideas.length} published synthetic projects, 1 submission and 1 pending revision.`);
  console.log(`Demo password for all seeded accounts: ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
