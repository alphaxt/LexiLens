import { z } from 'zod';

const publicConfigSchema = z
  .object({
    mode: z.enum(['local', 'oidc']).default('local'),
    apiUrl: z.string().url().default('http://localhost:4000'),
    issuer: z.string().url().optional(),
    clientId: z.string().min(1).optional(),
    redirectUri: z.string().url().optional(),
    postLogoutUri: z.string().url().optional(),
    audience: z.string().min(1).optional(),
    scope: z.string().min(1).optional(),
    production: z.boolean(),
  })
  .superRefine((config, context) => {
    const required = (field: keyof typeof config, message: string) => {
      if (!config[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    };
    if (config.production && config.mode !== 'oidc') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mode'],
        message: 'Production web builds require NEXT_PUBLIC_AUTH_MODE=oidc.',
      });
    }
    if (config.mode === 'oidc') {
      required('issuer', 'NEXT_PUBLIC_OIDC_ISSUER is required in OIDC mode.');
      required('clientId', 'NEXT_PUBLIC_OIDC_CLIENT_ID is required in OIDC mode.');
      required('redirectUri', 'NEXT_PUBLIC_OIDC_REDIRECT_URI is required in OIDC mode.');
      required('postLogoutUri', 'NEXT_PUBLIC_OIDC_POST_LOGOUT_URI is required in OIDC mode.');
      required('audience', 'NEXT_PUBLIC_OIDC_AUDIENCE is required in OIDC mode.');
      required('scope', 'NEXT_PUBLIC_OIDC_SCOPE is required in OIDC mode.');
      if (config.scope && !config.scope.split(/\s+/).includes('openid')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scope'],
          message: 'OIDC scope must include openid.',
        });
      }
      if (config.scope?.split(/\s+/).includes('offline_access')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scope'],
          message: 'offline_access is not permitted for this browser client.',
        });
      }
    }
    if (config.production) {
      for (const [field, value] of [
        ['apiUrl', config.apiUrl],
        ['issuer', config.issuer],
        ['redirectUri', config.redirectUri],
        ['postLogoutUri', config.postLogoutUri],
      ] as const) {
        if (value && !value.startsWith('https://')) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} must use HTTPS in production.`,
          });
        }
      }
    }
  });

export type PublicAuthConfig = z.infer<typeof publicConfigSchema>;

export function loadPublicAuthConfig(
  environment: Record<string, string | undefined> = process.env,
): PublicAuthConfig {
  return publicConfigSchema.parse({
    mode: environment.NEXT_PUBLIC_AUTH_MODE,
    apiUrl: environment.NEXT_PUBLIC_API_URL,
    issuer: environment.NEXT_PUBLIC_OIDC_ISSUER,
    clientId: environment.NEXT_PUBLIC_OIDC_CLIENT_ID,
    redirectUri: environment.NEXT_PUBLIC_OIDC_REDIRECT_URI,
    postLogoutUri: environment.NEXT_PUBLIC_OIDC_POST_LOGOUT_URI,
    audience: environment.NEXT_PUBLIC_OIDC_AUDIENCE,
    scope: environment.NEXT_PUBLIC_OIDC_SCOPE,
    production: environment.NODE_ENV === 'production',
  });
}

export const publicAuthConfig = loadPublicAuthConfig();
