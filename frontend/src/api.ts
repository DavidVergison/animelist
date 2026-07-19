import type {
  AddListItemRequest,
  AuthStatusResponse,
  ListEntry,
  LoginRequest,
  Media,
  RestoreSummary,
  UpdateProgressRequest,
} from '@suivi/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `Erreur API (${status})`);
  }
}

type UnauthorizedListener = () => void;
let onUnauthorized: UnauthorizedListener | null = null;

/** Registers the app-wide "kick back to login" callback fired on any 401 (README §9). */
export function setUnauthorizedHandler(handler: UnauthorizedListener | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type when there's an actual JSON body: Fastify's JSON parser
  // rejects an empty body sent with `application/json` (broke no-body calls like
  // logout), and a FormData body needs the browser's own multipart boundary header,
  // not ours.
  const isFormData = init?.body instanceof FormData;
  const hasJsonBody = init?.body !== undefined && !isFormData;
  const res = await fetch(path, {
    ...init,
    ...(hasJsonBody ? { headers: { 'Content-Type': 'application/json', ...init?.headers } } : {}),
  });

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401);
  }
  if (!res.ok) {
    throw new ApiError(res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function getAuthStatus(): Promise<AuthStatusResponse> {
  return request('/api/auth/status');
}

export function login(password: string): Promise<void> {
  const body: LoginRequest = { password };
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
}

export function logout(): Promise<void> {
  return request('/api/auth/logout', { method: 'POST' });
}

export function getList(): Promise<ListEntry[]> {
  return request('/api/list');
}

export function searchAnime(term: string): Promise<Media[]> {
  return request(`/api/search?q=${encodeURIComponent(term)}`);
}

export function addToList(anilistId: number): Promise<ListEntry> {
  const body: AddListItemRequest = { anilistId };
  return request('/api/list', { method: 'POST', body: JSON.stringify(body) });
}

export function updateProgress(anilistId: number, progress: number): Promise<ListEntry> {
  const body: UpdateProgressRequest = { progress };
  return request(`/api/list/${anilistId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function removeFromList(anilistId: number): Promise<void> {
  return request(`/api/list/${anilistId}`, { method: 'DELETE' });
}

export function restoreBackup(file: File): Promise<RestoreSummary> {
  const formData = new FormData();
  formData.append('file', file);
  return request('/api/backup/restore', { method: 'POST', body: formData });
}

/** Downloads the backup as a real file (honors the server's `Content-Disposition`
 * filename) rather than navigating directly, so an expired session still goes through
 * the normal 401 -> login-screen handling instead of showing a raw JSON error page. */
export async function downloadBackup(): Promise<void> {
  const res = await fetch('/api/backup');
  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401);
  }
  if (!res.ok) {
    throw new ApiError(res.status);
  }
  const blob = await res.blob();
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'suivi-anime.json';

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
