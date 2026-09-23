/** Feedback is independent of CircuitDocument. A remote adapter owns authentication,
 * authorization and atomic quota checks, never the view. */
export type FeedbackKind = 'review' | 'idea' | 'issue';
export type FeedbackVisibility = 'public' | 'private';
export interface FeedbackEntry {
  id: string;
  nickname: string;
  content: string;
  kind: FeedbackKind;
  visibility: FeedbackVisibility;
  createdAt: string;
  updatedAt: string | null;
}
export interface FeedbackPost extends FeedbackEntry { canManage: boolean }
export interface AdminFeedbackPost extends FeedbackEntry { deletedAt: string | null }
export interface FeedbackDraft {
  nickname: string;
  content: string;
  kind: FeedbackKind;
  visibility: FeedbackVisibility;
}
export type FeedbackError = 'INVALID_INPUT' | 'DAILY_LIMIT' | 'NOT_FOUND' | 'UNAVAILABLE' | 'FORBIDDEN';
export type FeedbackResult<T> = { ok: true; value: T } | { ok: false; code: FeedbackError };
export interface FeedbackPage { posts: FeedbackPost[]; nextCursor: string | null }
export interface FeedbackGateway {
  /** The adapter silently obtains/persists the anonymous identity; the UI never supplies a UID. */
  list(input: { scope: 'public' | 'mine'; cursor?: string }): Promise<FeedbackResult<FeedbackPage>>;
  create(draft: FeedbackDraft): Promise<FeedbackResult<FeedbackPost>>;
  /** Mutations must check the authenticated identity regardless of the UI canManage hint. */
  update(input: { id: string; draft: FeedbackDraft }): Promise<FeedbackResult<FeedbackPost>>;
  /** Retains the final body for admins; does not refund creation quota. */
  remove(input: { id: string }): Promise<FeedbackResult<void>>;
}
/** Separate privileged port. Remote implementations must authorize every request. */
export interface FeedbackAdminGateway {
  list(): Promise<FeedbackResult<AdminFeedbackPost[]>>;
}
export const feedbackLimits = { nickname: 20, content: 2000, daily: 3, pageSize: 20 } as const;
export function validFeedbackDraft(draft: FeedbackDraft): boolean {
  return typeof draft.nickname === 'string' && draft.nickname.trim().length > 0 && draft.nickname.trim().length <= feedbackLimits.nickname
    && typeof draft.content === 'string' && draft.content.trim().length > 0 && draft.content.trim().length <= feedbackLimits.content
    && ['review', 'idea', 'issue'].includes(draft.kind) && ['public', 'private'].includes(draft.visibility);
}
/** Quota days are Korea calendar days, independent of the device's time zone. */
export function feedbackDay(time: Date): string { return new Date(time.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
