import { Component, DestroyRef, inject, ChangeDetectorRef, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { NgIf } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth } from '../../../services/auth';
import { environment } from '../../../../environments/environment';

interface LoginResponse {
  success: boolean;
  message?: string;
  userID?: number;
  fullName?: string;
  username?: string;
  role?: string;
  token?: string;
}

interface LoginNavState {
  message?: string;
  type?: 'error' | 'success' | 'info';
}

@Component({
  imports: [FormsModule, RouterLink, NgIf],
  selector: 'app-login',
  styleUrl: './login.css',
  templateUrl: './login.html',
})
export class Login implements OnInit {
  username = '';
  password = '';
  loading = false;
  error = '';
  /** 'error' (default) → red text. 'success' / 'info' → green / neutral. */
  noticeType: 'error' | 'success' | 'info' = 'error';
  showPassword = false;

  /** Where to go after a successful login. Populated from ?redirect=. */
  private redirectTo = '/dashboard';

  private http = inject(HttpClient);
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    // 1) Show any one-shot notice forwarded from signup / guard.
    const nav = this.router.getCurrentNavigation();
    const state = (nav?.extras?.state ?? history.state) as LoginNavState | undefined;
    if (state?.message) {
      this.error = state.message;
      this.noticeType = state.type ?? 'info';
    }

    // 2) Honour ?redirect= from the auth guard.
    const redirect = this.route.snapshot.queryParamMap.get('redirect');
    if (this.isSafeRedirect(redirect)) {
      this.redirectTo = redirect!;
    }
  }

  get canSubmit(): boolean {
    return !this.loading
      && this.username.trim().length > 0
      && this.password.length > 0;
  }

  doLogin(): void {
    if (this.loading) return;
    this.error = '';

    const username = this.username.trim();
    const password = this.password;

    if (!username || !password) {
      this.noticeType = 'error';
      this.error = 'Username and password are required.';
      return;
    }

    this.loading = true;
    this.cdr.markForCheck();

    this.http.post<LoginResponse>(`${environment.apiBaseUrl}/users/login`, { username, password })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (res) => {
          if (res?.success && res.token && res.userID != null) {
            this.auth.setUser(
              {
                userID: res.userID,
                fullName: res.fullName?.trim() || username,
                username: res.username?.trim() || username,
                role: res.role?.trim() || 'user',
              },
              res.token
            );
            this.password = '';
            this.cdr.markForCheck();
            this.router.navigateByUrl(this.redirectTo).catch(() => { /* router surfaces nav errors */ });
          } else if (res?.success && (!res.token || res.userID == null)) {
            this.noticeType = 'error';
            this.error = 'Login succeeded but the server returned an incomplete session. Please try again.';
          } else {
            this.noticeType = 'error';
            this.error = res?.message?.trim() || 'Invalid username or password.';
          }
        },
        error: (err: HttpErrorResponse) => {
          this.noticeType = 'error';
          if (err.status === 0) {
            this.error = 'Network error. Check your connection.';
          } else if (err.status === 401 || err.status === 400) {
            this.error = err.error?.message?.trim() || 'Invalid username or password.';
          } else if (err.status === 429) {
            this.error = 'Too many attempts. Please wait and try again.';
          } else if (err.status >= 500) {
            this.error = 'Server error. Please try again later.';
          } else {
            this.error = err.error?.message?.trim() || 'Login failed. Please try again.';
          }
        },
      });
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement | null)?.select();
  }

  /**
   * Only allow same-origin, absolute paths. Rejects:
   *   "http://evil.com", "//evil.com", "javascript:...", ""
   */
  private isSafeRedirect(url: string | null | undefined): url is string {
    if (!url) return false;
    if (!url.startsWith('/')) return false;       // must be absolute path
    if (url.startsWith('//')) return false;       // protocol-relative → reject
    if (url.startsWith('/login')) return false;   // don't loop
    return true;
  }
}