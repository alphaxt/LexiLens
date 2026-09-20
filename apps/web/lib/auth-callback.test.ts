import { describe, expect, it } from 'vitest';
import { oidcCallbackErrorMessage } from './auth-callback';

describe('OIDC callback errors', () => {
  it('returns a safe authorization-error message without exposing callback details', () => {
    expect(oidcCallbackErrorMessage(new Error('access_denied'))).toContain('cancelled');
    expect(oidcCallbackErrorMessage(new Error('token=secret'))).toBe(
      'Sign-in was not completed. Please try again.',
    );
  });
});
