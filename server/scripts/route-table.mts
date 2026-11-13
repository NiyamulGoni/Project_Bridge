import { writeFileSync } from 'node:fs';
import { accountsRouter } from '../src/modules/accounts/routes.js';
import { adminRouter } from '../src/modules/admin/routes.js';
import { discoveryRouter } from '../src/modules/discovery/routes.js';
import { engagementRouter } from '../src/modules/engagement/routes.js';
import { messagingRouter } from '../src/modules/messaging/routes.js';
import { notificationsRouter } from '../src/modules/notifications/routes.js';
import { offersRouter } from '../src/modules/offers/routes.js';
import { projectsRouter } from '../src/modules/projects/routes.js';
import { reportsRouter } from '../src/modules/reports/routes.js';
import { rolesRouter } from '../src/modules/roles/routes.js';
import { shareRouter } from '../src/modules/sharing/routes.js';

type Row = { title: string; prefix: string; router: any; check: (path: string, method: string) => string; tests: (path: string) => string };
const SECTIONS: Row[] = [
  { title: 'Accounts', prefix: '/api/auth', router: accountsRouter, check: (p) => (p.startsWith('/me') ? 'Own account only' : p === '/config' || p === '/logout' ? 'None: public' : 'None: public, rate limited'), tests: (p) => (p.startsWith('/me/') ? 'profile, security, views' : 'accounts, hardening') },
  { title: 'Projects (owner and team)', prefix: '/api/projects', router: projectsRouter, check: (p) => (p === '/' || p === '/mine' || p === '/invites' ? 'Own records only' : p.startsWith('/invites/') ? 'The invited user only' : 'Owner or accepted editor, else 404'), tests: () => 'permissions, publish, maintain, hideDelete, security' },
  { title: 'Discovery (public views)', prefix: '/api/projects', router: discoveryRouter, check: (p) => (p === '/:id/share' ? 'Published only; Guest card fields' : 'Published only; fields by role (FIELDS_BY_TIER); Guest 20-project budget'), tests: (p) => (p === '/:id/share' ? 'sharing, views' : 'views, feed, search, projectView') },
  { title: 'Likes and comments', prefix: '/api/projects', router: engagementRouter, check: (p) => (p.includes(':commentId') ? 'Comment author only (403), published project' : 'Published project, else 404'), tests: () => 'engagement, security' },
  { title: 'Contact requests and messages', prefix: '/api/messaging', router: messagingRouter, check: (p) => (p.includes('conversations/:id') ? 'Participant only, else 404' : p.includes(':id') ? 'Recipient (accept, decline) or sender (withdraw), else 404' : 'Own records only'), tests: (p) => (p.includes('conversations') ? 'messages, security' : 'messaging, security') },
  { title: 'Paid offers', prefix: '/api/offers', router: offersRouter, check: (p) => (p === '/' ? 'Project owner or accepted editor, else 404' : 'Own offers only, else 404'), tests: () => 'offers, security' },
  { title: 'Notifications', prefix: '/api/notifications', router: notificationsRouter, check: () => 'Own notifications only, else 404', tests: () => 'notifications, security' },
  { title: 'Reports', prefix: '/api/reports', router: reportsRouter, check: () => 'Target must be visible to the reporter, else 404', tests: () => 'reports' },
  { title: 'Role requests', prefix: '/api/role-requests', router: rolesRouter, check: (p) => (p === '/' ? 'Active Uploader only (checked in the service)' : 'Own requests only'), tests: () => 'moderation' },
  { title: 'Admin', prefix: '/api/admin', router: adminRouter, check: (p) => (p.includes('conversation') ? 'Open report about that conversation; read is audited' : p.includes('/status') ? 'Professional target, not self, allowed transition' : p.includes('/remove') ? 'Confirmed report about that project' : 'Record must be in the expected state, else 404'), tests: (p) => (p.startsWith('/reviews') || p === '/ping' ? 'permissions, reports, publish' : p.startsWith('/offers') ? 'permissions, offers' : p.startsWith('/reports') && !p.includes('conf') && !p.includes('conv') ? 'permissions, reports' : 'permissions, moderation') },
  { title: 'Share page', prefix: '/p', router: shareRouter, check: () => 'Published only; Guest card fields, HTML-escaped', tests: () => 'sharing' },
];

let total = 0;
let out = `# Route security table

Step 13 of the backend plan. Every route, the permission that gates it, its record-level check, and the test files that cover it (in \`server/tests/\`, without the \`.test.ts\` ending).

This file is generated from the routers by \`server/scripts/route-table.mts\`; regenerate it after adding a route. \`security.test.ts\` walks the same routers and checks that a Guest gets 401 on every route not marked Public, and \`views.test.ts\` scans every GET route as every role for fields that role must not receive.

Gates: **Public** needs no sign-in. **requireAuth** needs any signed-in account that is not suspended or banned. **requirePermission(x)** looks up action \`x\` in \`server/src/lib/permissions.ts\`, which also blocks Restricted accounts where the table says so. Every Admin route also sits behind \`requireRole('ADMIN')\`.
`;
for (const s of SECTIONS) {
  out += `\n## ${s.title}\n\n| Method | Route | Permission | Record-level check | Tests |\n|---|---|---|---|---|\n`;
  for (const layer of s.router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      const first = layer.route.stack[0].handle.name as string;
      const gate = first.startsWith('require') ? first : 'Public';
      const path = layer.route.path as string;
      out += `| ${method.toUpperCase()} | \`${s.prefix}${path === '/' ? '' : path}\` | ${s.title === 'Admin' ? `requireRole(ADMIN)${gate === 'Public' ? '' : ` + ${gate}`}` : gate} | ${s.check(path, method)} | ${s.tests(path)} |\n`;
      total++;
    }
  }
}
out += `\n${total} routes in all.\n\n## Checked and left as they are\n\n- **Register (409) and team invites (201 or 404) reveal whether an email has an account.** Both are rate limited. Hiding this would need email verification, which the project does not have.\n- **Admins get 403, not 404, on routes their role can never use** (sending messages, accepting contact requests). The role gate refuses them before any record is looked up, so the answer is the same for every id and reveals nothing.\n- **A signed URL for a screenshot contains its storage path.** This is how Supabase signed URLs work, and the URL expires. The path is never returned as its own field.\n- **Project removal needs a confirmed report.** The plan also allowed "a review decision" as the basis; only the report route is built, because it leaves a clear record of why.\n`;
writeFileSync(new URL('../../docs/route-security.md', import.meta.url), out);
console.log('routes:', total);
