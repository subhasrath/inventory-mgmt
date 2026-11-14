import { Injectable, signal } from '@angular/core';
import { LoggedInUser } from '../models/user.model';

const USER_KEY  = 'ims_user';
const TOKEN_KEY = 'ims_token';

@Injectable({ providedIn: 'root' })
export class Auth {
  user = signal<LoggedInUser | null>(this.loadUser());

  private loadUser(): LoggedInUser | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  setUser(user: LoggedInUser | null, token?: string) {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      if (token) localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
    this.user.set(user);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return this.user() !== null && !!this.getToken();
  }

  logout() {
    this.setUser(null);
  }
}