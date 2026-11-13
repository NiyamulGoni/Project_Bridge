import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { ELIGIBLE, GUEST_SUMMARY_LIMIT, truncate } from '../discovery/visibility.js';

/**
 * FR12: what a share link carries, the same for every viewer and never more than a Guest's card.
 * A share link grants no extra access, and does not draw on the guest card budget.
 */
export async function shareInfo(id: string) {
  const project = await prisma.project.findFirst({ where: { ...ELIGIBLE, id }, select: { id: true, title: true, summary: true, thumbnailUrl: true } });
  if (!project) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
  const thumbnailUrl = project.thumbnailUrl?.startsWith('/') ? `${config.appUrl}${project.thumbnailUrl}` : project.thumbnailUrl;
  return {
    url: `${config.appUrl}/projects/${project.id}`,
    title: project.title,
    summary: truncate(project.summary, GUEST_SUMMARY_LIMIT),
    thumbnailUrl: thumbnailUrl ?? null,
  };
}

/**
 * FR12: ready-made social media share links for one project. Only a Professional, or the project's
 * own owner or accepted team member, gets them; everyone else is refused here, on the server.
 * The links point at the public /p/:id page, so what gets shared is still only the Guest card.
 */
export async function socialShareLinks(viewer: { id: string; role: string }, id: string) {
  const project = await prisma.project.findFirst({
    where: { ...ELIGIBLE, id },
    select: { id: true, title: true, ownerId: true, members: { where: { userId: viewer.id, status: 'ACCEPTED' }, select: { userId: true } } },
  });
  if (!project) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
  const onTeam = project.ownerId === viewer.id || project.members.length > 0;
  if (viewer.role !== 'PROFESSIONAL' && !onTeam) {
    throw new HttpError(403, 'FORBIDDEN', 'Only Professionals and this project’s own team can share it on social media.');
  }

  const url = `${config.appUrl}/p/${project.id}`;
  const u = encodeURIComponent(url);
  const text = encodeURIComponent(`${project.title} on ProjectBridge`);
  return {
    url,
    links: [
      { service: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
      { service: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
      { service: 'x', label: 'X', href: `https://twitter.com/intent/tweet?url=${u}&text=${text}` },
      { service: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${text}%20${u}` },
    ],
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A page for social crawlers, which do not run JavaScript. Every value is escaped. People are forwarded to the app. */
export function sharePage(info: Awaited<ReturnType<typeof shareInfo>>): string {
  const e = escapeHtml;
  const image = info.thumbnailUrl ? `\n<meta property="og:image" content="${e(info.thumbnailUrl)}">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${e(info.title)} · ProjectBridge</title>
<meta name="description" content="${e(info.summary)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ProjectBridge">
<meta property="og:title" content="${e(info.title)}">
<meta property="og:description" content="${e(info.summary)}">
<meta property="og:url" content="${e(info.url)}">${image}
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0; url=${e(info.url)}">
</head>
<body>
<p><a href="${e(info.url)}">Open “${e(info.title)}” on ProjectBridge</a></p>
</body>
</html>
`;
}
