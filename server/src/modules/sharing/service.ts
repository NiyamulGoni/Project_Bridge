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
