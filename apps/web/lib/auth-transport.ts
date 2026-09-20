import { publicAuthConfig } from './auth-config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type AuthenticatedFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function createAuthenticatedFetch(
  getAccessToken: () => string | null,
  onUnauthorized: () => void,
  config = publicAuthConfig,
): AuthenticatedFetch {
  return async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (config.mode === 'local') {
      const sessionId = getAccessToken();
      if (!sessionId) throw new ApiError(401, 'A local development session is required.');
      headers.set('x-local-session-id', sessionId);
    } else {
      const token = getAccessToken();
      if (!token) throw new ApiError(401, 'Please sign in to continue.');
      headers.set('authorization', `Bearer ${token}`);
    }
    const response = await fetch(`${config.apiUrl}${path}`, { ...init, headers });
    if (response.status === 401) {
      onUnauthorized();
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    if (response.status === 403)
      throw new ApiError(403, 'You do not have permission for this action.');
    return response;
  };
}

export async function readApiError(response: Response, fallback: string): Promise<ApiError> {
  if (response.status === 401)
    return new ApiError(401, 'Your session has expired. Please sign in again.');
  if (response.status === 403)
    return new ApiError(403, 'You do not have permission for this action.');
  return new ApiError(response.status, fallback);
}
