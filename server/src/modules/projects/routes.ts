import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { param } from '../../lib/params.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ACCEPTED_IMAGE_TYPES } from './media.js';
import {
  createProjectSchema,
  deleteSchema,
  inviteSchema,
  milestoneSchema,
  milestoneUpdateSchema,
  progressSchema,
  submitSchema,
  updateProjectSchema,
} from './schemas.js';
import * as projects from './service.js';

/**
 * FR02–FR04: the owner/editor side of projects. Mounted on /api/projects before the public
 * discovery routes, so every route here names its own gate, first in the chain. Reads, and the
 * routes that let a RESTRICTED owner reduce their exposure, stay on plain requireAuth. Leaving a
 * team is the same idea for a RESTRICTED editor, see requireSelfOrEdit.
 */
export const projectsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.media.maxBytes, files: config.media.maxFiles },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'INVALID_FILE', 'Images must be PNG, JPEG or WebP.'));
  },
});

/** Runs a multer handler and turns its errors into the API's error shape. */
function images(handler: RequestHandler, sizeMessage: string, countMessage: string): RequestHandler {
  return (req, res, next) => {
    handler(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? sizeMessage
            : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
              ? countMessage
              : 'The upload could not be read.';
        next(new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_FILE', message));
        return;
      }
      next(err);
    });
  };
}

const maxMb = config.media.maxBytes / (1024 * 1024);
const screenshots = images(
  upload.array('screenshots', config.media.maxFiles),
  `Each screenshot must be at most ${maxMb} MB.`,
  `Upload at most ${config.media.maxFiles} screenshots, using the "screenshots" field.`,
);
const cover = images(upload.single('cover'), `The cover image must be at most ${maxMb} MB.`, 'Upload one image, using the "cover" field.');


projectsRouter.get('/mine', requireAuth, async (req, res) => {
  res.json({ items: await projects.listMine(req.user!) });
});

projectsRouter.get('/invites', requireAuth, async (req, res) => {
  res.json({ items: await projects.listInvites(req.user!) });
});

projectsRouter.post('/invites/:projectId/accept', requirePermission('publish'), async (req, res) => {
  await projects.respondToInvite(req.user!, param(req, 'projectId'), true);
  res.json({ ok: true });
});

projectsRouter.post('/invites/:projectId/decline', requireAuth, async (req, res) => {
  await projects.respondToInvite(req.user!, param(req, 'projectId'), false);
  res.json({ ok: true });
});

projectsRouter.post('/', requirePermission('publish'), validateBody(createProjectSchema), async (req, res) => {
  const project = await projects.createProject(req.user!, req.body);
  res.status(201).json({ id: project.id });
});

projectsRouter.get('/:id/workspace', requireAuth, async (req, res) => {
  res.json(await projects.workspace(req.user!, param(req, 'id')));
});

projectsRouter.get('/:id/preview', requireAuth, async (req, res) => {
  res.json(await projects.preview(req.user!, param(req, 'id')));
});

projectsRouter.patch('/:id', requirePermission('edit'), validateBody(updateProjectSchema), async (req, res) => {
  await projects.updateProject(req.user!, param(req, 'id'), req.body);
  res.json(await projects.workspace(req.user!, param(req, 'id')));
});

projectsRouter.post('/:id/submit', requirePermission('publish'), validateBody(submitSchema), async (req, res) => {
  await projects.submitProject(req.user!, param(req, 'id'));
  res.json({ ok: true, status: 'SUBMITTED' });
});

projectsRouter.post('/:id/media', requirePermission('edit'), screenshots, async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  await projects.addMedia(req.user!, param(req, 'id'), files);
  res.status(201).json(await projects.workspace(req.user!, param(req, 'id')));
});

projectsRouter.delete('/:id/media/:mediaId', requirePermission('edit'), async (req, res) => {
  await projects.removeMedia(req.user!, param(req, 'id'), param(req, 'mediaId'));
  res.status(204).end();
});

projectsRouter.post('/:id/cover', requirePermission('edit'), cover, async (req, res) => {
  await projects.setCover(req.user!, param(req, 'id'), req.file);
  res.status(201).json(await projects.workspace(req.user!, param(req, 'id')));
});

projectsRouter.delete('/:id/cover', requirePermission('edit'), async (req, res) => {
  await projects.removeCover(req.user!, param(req, 'id'));
  res.json(await projects.workspace(req.user!, param(req, 'id')));
});

projectsRouter.post('/:id/progress', requirePermission('edit'), validateBody(progressSchema), async (req, res) => {
  const entry = await projects.addProgress(req.user!, param(req, 'id'), req.body.body);
  res.status(201).json({ id: entry.id });
});

projectsRouter.delete('/:id/progress/:entryId', requirePermission('edit'), async (req, res) => {
  await projects.deleteProgress(req.user!, param(req, 'id'), param(req, 'entryId'));
  res.status(204).end();
});

projectsRouter.post('/:id/milestones', requirePermission('edit'), validateBody(milestoneSchema), async (req, res) => {
  const milestone = await projects.addMilestone(req.user!, param(req, 'id'), req.body);
  res.status(201).json({ id: milestone.id });
});

projectsRouter.patch('/:id/milestones/:milestoneId', requirePermission('edit'), validateBody(milestoneUpdateSchema), async (req, res) => {
  await projects.updateMilestone(req.user!, param(req, 'id'), param(req, 'milestoneId'), req.body);
  res.json({ ok: true });
});

projectsRouter.delete('/:id/milestones/:milestoneId', requirePermission('edit'), async (req, res) => {
  await projects.deleteMilestone(req.user!, param(req, 'id'), param(req, 'milestoneId'));
  res.status(204).end();
});

projectsRouter.post('/:id/members', requirePermission('edit'), validateBody(inviteSchema), async (req, res) => {
  await projects.inviteMember(req.user!, param(req, 'id'), req.body.email);
  res.status(201).json({ ok: true });
});

const requireEdit = requirePermission('edit');

/** Removing yourself (leaving a team) only needs a session, even when RESTRICTED. Removing anyone else is an edit. */
const requireSelfOrEdit: RequestHandler = (req, res, next) => {
  if (req.user && req.user.id === param(req, 'userId')) {
    next();
    return;
  }
  requireEdit(req, res, next);
};

projectsRouter.delete('/:id/members/:userId', requireSelfOrEdit, async (req, res) => {
  await projects.removeMember(req.user!, param(req, 'id'), param(req, 'userId'));
  res.status(204).end();
});

projectsRouter.post('/:id/hide', requireAuth, async (req, res) => {
  await projects.setHidden(req.user!, param(req, 'id'), true);
  res.json({ ok: true, status: 'HIDDEN' });
});

projectsRouter.post('/:id/unhide', requirePermission('edit'), async (req, res) => {
  await projects.setHidden(req.user!, param(req, 'id'), false);
  res.json({ ok: true, status: 'PUBLISHED' });
});

projectsRouter.delete('/:id', requireAuth, validateBody(deleteSchema), async (req, res) => {
  await projects.deleteProject(req.user!, param(req, 'id'), req.body.confirmTitle);
  res.json({ ok: true, status: 'DELETED' });
});
