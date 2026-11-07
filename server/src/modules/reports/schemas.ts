import { z } from 'zod';
import { REPORT_TARGETS } from '../../domain.js';

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(10, 'Explain what is wrong in at least 10 characters.').max(1000),
});

export const dismissReportSchema = z.object({
  note: z.string({ required_error: 'Give a reason for the decision.' }).trim().min(3, 'Give a reason for the decision.').max(1000),
});
