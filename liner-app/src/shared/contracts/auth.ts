export interface PublicUser {
  id: string;
  email?: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  isPublic?: boolean;
  showActivity?: boolean;
  showHistory?: boolean;
  showLikedTracks?: boolean;
  participateLeaderboards?: boolean;
  /** true when the account can sign in with a password (always false for pure Discord accounts until one is added) */
  hasPassword?: boolean;
  /** throwaway guest account (no email, no password) */
  isGuest?: boolean;
}

export type AuthUser = PublicUser;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: PublicUser;
  expiresAt?: number;
  /**
   * Durable client-held credential for POST /api/auth/recover — re-signs the
   * browser in (or rebuilds the wiped account) when the server loses the
   * session database. Cleared only by explicit sign-out / ban.
   */
  recoveryToken?: string;
}

export interface UsernameAvailability {
  username: string;
  valid: boolean;
  available: boolean;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | Date;
  user: PublicUser;
  /** see AuthTokens.recoveryToken */
  recoveryToken?: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  username: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}
