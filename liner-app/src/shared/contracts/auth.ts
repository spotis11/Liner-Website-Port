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
  /** Liner Pro — the site owner is Pro forever; others by owner grant. */
  isPro?: boolean;
}

export type AuthUser = PublicUser;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: PublicUser;
  expiresAt?: number;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | Date;
  user: PublicUser;
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
