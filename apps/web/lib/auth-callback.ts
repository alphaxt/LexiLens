export function oidcCallbackErrorMessage(error: unknown): string {
  return error instanceof Error && error.message === 'access_denied'
    ? 'Sign-in was cancelled or denied. Please try again.'
    : 'Sign-in was not completed. Please try again.';
}
