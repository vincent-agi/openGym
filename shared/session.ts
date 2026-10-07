/** Wire types of the core routes: sessions, configuration, state sync and the admin dashboard. */

/** Every failure answers `{ error }` with a status code. */
export interface ApiError { error: string }

export interface OkResponse { ok: true }

/** What the app is told about the signed-in user. `social` is true when they turned sharing on. */
export interface SessionUser { id: string; name: string; admin: boolean; social: boolean }
/** `GET /api/me`, and the answer of a successful register or login. */
export interface MeResponse { user: SessionUser }

/** `GET /api/config` (public). */
export interface ConfigResponse { invite_only: boolean; social_enabled: boolean }
/** `GET /api/health` (public). */
export interface HealthResponse { ok: true; users: number }

/** `GET /api/data`. The state is whatever the app saved; the server stores it as sent. */
export interface StateResponse { state: Record<string, unknown> | null }
/** `PUT /api/data`. */
export interface PutStateBody { state: Record<string, unknown> }
export interface PutStateResponse { ok: true; ts: number | null }

/** A row of the admin dashboard. The social part is counts only, never who or what. */
export interface AdminUserRow {
  id: string; name: string; created: string | null; disabled: boolean; admin: boolean; invitedBy: string | null
  workouts: number; lastWorkout: string | null; lastSync: number | null; hasPush: boolean
  live: { name: string; exIdx: number; exTotal: number; setsDone: number; setsTotal: number; startedAt: number; updatedAt: number } | null
  social: { enabled: boolean; friends: number; challenges: number }
}
/** `GET /api/admin/users`. */
export interface AdminUsersResponse { users: AdminUserRow[]; invite_only: boolean; now: number }
/** One invitation code. */
export interface Invite { code: string; note: string; createdBy: string; created: string; usedBy?: string; revoked?: boolean }
/** `GET /api/admin/invites`. */
export interface AdminInvitesResponse { invites: Array<Invite & { usedByName: string | null }>; invite_only: boolean }
