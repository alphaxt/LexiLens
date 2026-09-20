import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
    MAX_TEXT_CHARACTERS: z.coerce.number().int().min(1000).max(1_000_000).default(250_000),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(25_000_000).default(10_000_000),
    EXTRACTION_MAX_CHARACTERS: z.coerce.number().int().min(1000).max(1_000_000).default(250_000),
    EXTRACTION_MAX_PAGES: z.coerce.number().int().min(1).max(1000).default(100),
    EXTRACTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
    EXTRACTION_LEASE_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
    EXTRACTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(3),
    EXTRACTION_RECONCILIATION_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    OCR_MODE: z.enum(['disabled', 'configured']).default('disabled'),
    OCR_PROVIDER_ENDPOINT: z.string().url().optional(),
    OCR_PROVIDER_CREDENTIAL: z.string().min(1).optional(),
    STORAGE_MODE: z.enum(['memory', 's3']).default('memory'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().min(3).optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    SCANNER_MODE: z.enum(['magic', 'configured']).default('magic'),
    SCANNER_ENDPOINT: z.string().url().optional(),
    SCANNER_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
    SCANNER_VERSION: z.string().min(1).optional(),
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
    const required = (field: keyof typeof config, message: string) => {
      if (!config[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    };
    const production = config.NODE_ENV === 'production';
    if (production && config.AUTH_MODE !== 'oidc')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_MODE'],
        message: 'Production requires AUTH_MODE=oidc.',
      });
    if (production && config.STORAGE_MODE !== 's3')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_MODE'],
        message: 'Production requires private S3-compatible storage.',
      });
    if (production && config.PERSISTENCE_MODE !== 'postgresql')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PERSISTENCE_MODE'],
        message: 'Production requires PERSISTENCE_MODE=postgresql.',
      });
    if (production && config.SCANNER_MODE !== 'configured')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SCANNER_MODE'],
        message:
          'Production requires SCANNER_MODE=configured; magic is development/test format validation only.',
      });
    if (config.SCANNER_MODE === 'configured') {
      required('SCANNER_ENDPOINT', 'SCANNER_ENDPOINT is required when scanner is configured.');
      required('SCANNER_VERSION', 'SCANNER_VERSION is required when scanner is configured.');
      if (production && config.SCANNER_ENDPOINT && !config.SCANNER_ENDPOINT.startsWith('https://'))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SCANNER_ENDPOINT'],
          message: 'Production scanner endpoint must use HTTPS.',
        });
    }
    if (config.OCR_MODE === 'configured') {
      required(
        'OCR_PROVIDER_ENDPOINT',
        'OCR_PROVIDER_ENDPOINT is required when OCR is configured.',
      );
      required(
        'OCR_PROVIDER_CREDENTIAL',
        'OCR_PROVIDER_CREDENTIAL is required when OCR is configured.',
      );
      if (
        production &&
        config.OCR_PROVIDER_ENDPOINT &&
        !config.OCR_PROVIDER_ENDPOINT.startsWith('https://')
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OCR_PROVIDER_ENDPOINT'],
          message: 'Production OCR provider endpoint must use HTTPS.',
        });
    }
    if (config.STORAGE_MODE === 's3') {
      required('S3_ENDPOINT', 'S3_ENDPOINT is required for S3 storage.');
      required('S3_BUCKET', 'S3_BUCKET is required for S3 storage.');
      if (Boolean(config.S3_ACCESS_KEY_ID) !== Boolean(config.S3_SECRET_ACCESS_KEY))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_ACCESS_KEY_ID'],
          message: 'Set both S3 static credentials or neither; production uses workload identity.',
        });
      if (production && config.S3_ENDPOINT && !config.S3_ENDPOINT.startsWith('https://'))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_ENDPOINT'],
          message: 'Production S3 endpoint must use HTTPS.',
        });
    }
    if (config.PERSISTENCE_MODE === 'postgresql') {
      required('DATABASE_URL', 'DATABASE_URL is required in PostgreSQL persistence mode.');
      if (config.DATABASE_URL && !/^postgres(?:ql)?:\/\//.test(config.DATABASE_URL))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL must use the postgresql:// or postgres:// protocol.',
        });
    }
    if (
      config.AUTH_MODE === 'local' &&
      (!['127.0.0.1', 'localhost', '::1'].includes(config.HOST) || production)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HOST'],
        message: 'Local authentication mode is only permitted for non-production loopback hosts.',
      });
    if (config.AUTH_MODE === 'oidc') {
      required('OIDC_ISSUER_URL', 'OIDC_ISSUER_URL is required in OIDC mode.');
      required('OIDC_JWKS_URI', 'OIDC_JWKS_URI is required in OIDC mode.');
      required('OIDC_AUDIENCE', 'OIDC_AUDIENCE is required in OIDC mode.');
      for (const field of ['OIDC_ISSUER_URL', 'OIDC_JWKS_URI'] as const)
        if (production && config[field] && !config[field].startsWith('https://'))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `Production ${field === 'OIDC_ISSUER_URL' ? 'OIDC issuer' : 'JWKS URI'} must use HTTPS.`,
          });
    }
  });
export type AppConfig = z.infer<typeof environmentSchema>;
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return environmentSchema.parse(environment);
}
