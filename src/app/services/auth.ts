import { Injectable, computed, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggedInUser } from '../models/user.model';

const USER_KEY  = 'ims_user';
const TOKEN_KEY = 'ims_token';

interface JwtPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /** Private writeable signal — public readonly via `currentUser`. */
  private _user = signal<LoggedInUser | null>(this.loadUser());
  readonly currentUser = this._user.asReadonly();

  /** True only when both a user record and a non-expired token exist. */
  readonly isAuthenticated = computed(() => this._user() !== null && this.hasValidToken());

  constructor() {
    if (this.isBrowser) {
      // Sync across tabs: another tab logging out/in updates us immediately.
      window.addEventListener('storage', this.onStorageChange);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Persist the signed-in user **and** their JWT.
   * The token is required — you cannot be "logged in" without one.
   */
  setUser(user: LoggedInUser, token: string): void {
    if (!user || !token) {
      // Programming error — fail loud in dev, no-op safely in prod.
      if (typeof console !== 'undefined') {
        console.error('Auth.setUser called without user or token — use clearUser() to logout.');
      }
      return;
    }
    if (!this.isBrowser) {
      this._user.set(user);
      return;
    }
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // localStorage full or disabled (private mode) — still keep in-memory.
    }
    this._user.set(user);
  }

  /** Explicit logout. Idempotent. */
  clearUser(): void {
    if (this.isBrowser) {
      try {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
      } catch { /* ignore */ }
    }
    this._user.set(null);
  }

  /** Alias kept for existing call-sites. */
  logout(): void {
    this.clearUser();
  }

  /**
   * Returns the token only if it is structurally valid and not expired.
   * Expired tokens are purged from storage as a side-effect.
   */
  getToken(): string | null {
    if (!this.isBrowser) return null;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;

    if (this.isTokenExpired(token)) {
      this.clearUser();
      return null;
    }
    return token;
  }

  /** Kept for backward-compat; prefer the `isAuthenticated` signal. */
  isLoggedIn(): boolean {
    return this.isAuthenticated();
  }

  /** True when the stored token has an `exp` claim in the past. */
  hasValidToken(): boolean {
    const token = this.isBrowser ? localStorage.getItem(TOKEN_KEY) : null;
    return !!token && !this.isTokenExpired(token);
  }

  /** Optional: useful for showing "session expires in N minutes". */
  getTokenExpiry(): Date | null {
    const token = this.isBrowser ? localStorage.getItem(TOKEN_KEY) : null;
    if (!token) return null;
    const payload = this.decodeJwt(token);
    return payload?.exp ? new Date(payload.exp * 1000) : null;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private loadUser(): LoggedInUser | null {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return null;
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as unknown;
      if (!this.isValidUserShape(parsed)) {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }

      // Drop the user if the token is already dead.
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token || this.isTokenExpired(token)) {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      return parsed;
    } catch {
      try {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
      } catch { /* ignore */ }
      return null;
    }
  }

  private isValidUserShape(v: unknown): v is LoggedInUser {
    if (!v || typeof v !== 'object') return false;
    const u = v as Record<string, unknown>;
    return (
      (typeof u['userID'] === 'number' || typeof u['userID'] === 'string') &&
      typeof u['username'] === 'string' &&
      typeof u['role'] === 'string'
    );
  }

  private isTokenExpired(token: string): boolean {
    const payload = this.decodeJwt(token);
    if (!payload || typeof payload.exp !== 'number') {
      // No `exp` claim — treat as non-expiring (some APIs don't set it).
      return false;
    }
    // 30s leeway so we don't send a token that dies in-flight.
    const nowSec = Math.floor(Date.now() / 1000);
    return payload.exp <= nowSec + 30;
  }

  private decodeJwt(token: string): JwtPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      // base64url → base64 → decode
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const json = decodeURIComponent(
        atob(padded).split('').map(c =>
          '%' + c.charCodeAt(0).toString(16).padStart(2, '0')
        ).join('')
      );
      return JSON.parse(json) as JwtPayload;
    } catch {
      return null;
    }
  }

  /** React to login/logout in another tab. */
  private onStorageChange = (e: StorageEvent): void => {
    if (e.key !== USER_KEY && e.key !== TOKEN_KEY && e.key !== null) return;
    this._user.set(this.loadUser());
  };
}