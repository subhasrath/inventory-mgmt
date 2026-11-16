import { Component, DestroyRef, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth } from '../../../services/auth';
import { environment } from '../../../../environments/environment';

interface SignupResponse {
  success: boolean;
  message?: string;
  userID?: number;
  fullName?: string;
  username?: string;
  role?: string;
  token?: string;
}

@Component({
  imports: [FormsModule, RouterLink, NgIf],
  selector: 'app-signup',
  styleUrl: './signup.css',
  templateUrl: './signup.html',
})
export class Signup {
  fullName = '';
  username = '';
  password = '';
  confirmPassword = '';
  loading = false;
  error = '';
  showPassword = false;
  showConfirmPassword = false;

  private http = inject(HttpClient);
  private auth = inject(Auth);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  get passwordMismatch(): boolean {
    return this.confirmPassword.length > 0 && this.password !== this.confirmPassword;
  }

  get canSubmit(): boolean {
    return !this.loading
      && this.fullName.trim().length > 0
      && this.username.trim().length > 0
      && this.password.length >= 8
      && this.password === this.confirmPassword;
  }

  doSignup(): void {
    if (this.loading) return;
    this.error = '';

    const fullName = this.fullName.trim();
    const username = this.username.trim();
    const { password, confirmPassword } = this;

    if (!fullName) { this.error = 'Full name is required.'; return; }
    if (!username) { this.error = 'Username is required.'; return; }
    if (password.length < 8) { this.error = 'Password must be at least 8 characters.'; return; }
    if (password !== confirmPassword) { this.error = 'Passwords do not match.'; return; }

    this.loading = true;
    this.cdr.markForCheck();

    this.http.post<SignupResponse>(`${environment.apiBaseUrl}/users/signup`, {
      fullName,
      username,
      password,
      confirmPassword,
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (res) => {
          // Success requires *both* a token and a userID — never trust partial payloads.
          if (res?.success && res.token && res.userID != null) {
            this.auth.setUser(
              {
                userID: res.userID,
                fullName: res.fullName?.trim() || fullName,
                username: res.username?.trim() || username,
                role: res.role?.trim() || 'admin',
              },
              res.token
            );
            this.password = '';
            this.confirmPassword = '';
            this.cdr.markForCheck();
            this.router.navigateByUrl('/dashboard').catch(() => { /* router surfaces nav errors */ });
          } else if (res?.success && (!res.token || res.userID == null)) {
            // Account created, but no usable session was returned — send to login
            // with a one-shot "please sign in" notice so the user isn't confused.
            this.router
              .navigate(['/login'], { state: { message: 'Account created. Please sign in.' } })
              .catch(() => { /* router surfaces nav errors */ });
          } else {
            this.error = res?.message?.trim() || 'Signup failed. Please try again.';
          }
        },
        error: (err: HttpErrorResponse) => {
          if (err.status === 0) {
            this.error = 'Network error. Check your connection.';
          } else if (err.status === 409) {
            this.error = err.error?.message?.trim() || 'Username already taken.';
          } else if (err.status === 400) {
            this.error = err.error?.message?.trim() || 'Please check the form and try again.';
          } else if (err.status === 429) {
            this.error = 'Too many attempts. Please wait and try again.';
          } else if (err.status >= 500) {
            this.error = 'Server error. Please try again later.';
          } else {
            this.error = err.error?.message?.trim() || 'Signup failed. Please try again.';
          }
        },
      });
  }

  togglePassword(): void { this.showPassword = !this.showPassword; }
  toggleConfirmPassword(): void { this.showConfirmPassword = !this.showConfirmPassword; }

  /** Select-all on focus so a wrong-password re-type is one keystroke. */
  selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement | null)?.select();
  }
}