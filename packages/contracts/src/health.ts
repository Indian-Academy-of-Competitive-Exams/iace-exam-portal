import { z } from 'zod';

export const dependencyHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSec: z.number(),
  timestamp: z.string(),
  dependencies: z.object({
    database: dependencyHealthSchema,
    redis: dependencyHealthSchema,
    storage: dependencyHealthSchema,
  }),
});

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
