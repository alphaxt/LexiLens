import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
    MAX_TEXT_CHARACTERS: z.coerce.number().int().min(1000).max(1_000_000).default(250_000),
    ENABLE_HEALTHCARE_ANALYSIS: z
      .string()
      .default('false')
      .transform((value) => value === 'true'),
    PERSISTENCE_MODE: z.enum(['memory', 'postgresql']).default('memory'),
    DATABASE_URL: z.string().url().optional(),
    AUTH_MODE: z.enum(['local', 'oidc']).default('local'),
    OIDC_ISSUER_URL: z.string().url().optional(),
    OIDC_JWKS_URI: z.string().url().optional(),
    OIDC_AUDIENCE: z.string().min(1).optional(),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.AUTH_MODE !== 'oidc') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_MODE'],
        message: 'Production requires AUTH_MODE=oidc.',
      });
    }
    if (config.NODE_ENV === 'production' && config.PERSISTENCE_MODE !== 'postgresql') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PERSISTENCE_MODE'],
        message: 'Production requires PERSISTENCE_MODE=postgresql.',
      });
    }
    if (config.PERSISTENCE_MODE === 'postgresql') {
      if (!config.DATABASE_URL) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required in PostgreSQL persistence mode.',
        });
      } else if (!/^postgres(?:ql)?:\/\//.test(config.DATABASE_URL)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL must use the postgresql:// or postgres:// protocol.',
        });
      }
    }
    if (config.AUTH_MODE === 'local' && !['127.0.0.1', 'localhost', '::1'].includes(config.HOST)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HOST'],
        message: 'Local authentication mode requires a loopback HOST.',
      });
    }
    if (config.AUTH_MODE === 'oidc') {
      if (!config.OIDC_ISSUER_URL) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OIDC_ISSUER_URL'],
          message: 'OIDC_ISSUER_URL is required in OIDC mode.',
        });
      }
      if (!config.OIDC_JWKS_URI) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OIDC_JWKS_URI'],
          message: 'OIDC_JWKS_URI is required in OIDC mode.',
        });
      }
      if (!config.OIDC_AUDIENCE) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OIDC_AUDIENCE'],
          message: 'OIDC_AUDIENCE is required in OIDC mode.',
        });
      }
      if (config.NODE_ENV === 'production') {
        if (config.OIDC_ISSUER_URL && !config.OIDC_ISSUER_URL.startsWith('https://')) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['OIDC_ISSUER_URL'],
            message: 'Production OIDC issuer must use HTTPS.',
          });
        }
        if (config.OIDC_JWKS_URI && !config.OIDC_JWKS_URI.startsWith('https://')) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['OIDC_JWKS_URI'],
            message: 'Production JWKS URI must use HTTPS.',
          });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return environmentSchema.parse(environment);
}
