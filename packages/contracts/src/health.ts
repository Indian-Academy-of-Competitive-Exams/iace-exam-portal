import { z } from 'zod';

export const dependencyHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

/** Storage is reported but not required to serve: a signed image URL failing is not a lost sitting. */
export const healthDependenciesSchema = z.object({
  database: dependencyHealthSchema,
  redis: dependencyHealthSchema,
  storage: dependencyHealthSchema,
  queue: dependencyHealthSchema,
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSec: z.number(),
  timestamp: z.string(),
  dependencies: healthDependenciesSchema,
});

/** What readiness turns on — a pod missing any of these can serve nothing worth serving. */
export const READINESS_DEPENDENCIES = ['database', 'redis', 'queue'] as const;

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;
export type HealthDependencies = z.infer<typeof healthDependenciesSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
