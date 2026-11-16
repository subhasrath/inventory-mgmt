import {
  ChangeDetectorRef, Component, OnInit, OnDestroy, inject, signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { Subject, of } from 'rxjs';
import { catchError, finalize, takeUntil, timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Auth } from '../../services/auth';

interface ExpiringBatch {
  batchID: number;
  productID: number;
  itemName: string;
  batchNo: string;
  expiryDate: string;
  qtyBalance: number;
}

interface LowStockItem {
  productID: number;
  itemName: string;
  currentStock: number;
  reorderLevel: number;
}

interface DashboardData {
  todaySales: number;
  todayInvoiceCount: number;
  expiringBatches: ExpiringBatch[];
  lowStockItems: LowStockItem[];
}

type ApiError = HttpErrorResponse | { name: string; message?: string };

const HTTP_TIMEOUT_MS = 15_000;
const MIN_PASSWORD_LEN = 6;

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-dashboard',
  styleUrl: './dashboard.css',
  templateUrl: './dashboard.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  private destroy$ = new Subject<void>();

  user = this.auth.currentUser;

  // ---- password change ----
  newPassword = '';
  confirmPassword = '';
  showNewPassword = false;
  showConfirmPassword = false;
  pwLoading = false;
  pwMessage = '';
  pwSuccess = false;

  // ---- dashboard summary ----
  summary = signal<DashboardData | null>(null);
  summaryLoading = false;
  summaryError = '';

  // ---- company config check ----
  companyConfigured = signal<boolean>(true);
  companyCheckFailed = false;

  ngOnInit(): void {
    this.loadCompanyStatus();
    this.loadSummary();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ---------------- Company status ----------------
  private loadCompanyStatus(): void {
    this.http.get<{ configured: boolean }>(
      `${environment.apiBaseUrl}/company/configured`
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      catchError((err: ApiError) => {
        // Distinguish "not configured" (200 + false) from "couldn't check"
        this.companyCheckFailed = true;
        this.logError('loadCompanyStatus', err);
        return of({ configured: true }); // don't block user on transient failure
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.companyConfigured.set(res.configured);
      this.cdr.markForCheck();
    });
  }

  // ---------------- Summary ----------------
  loadSummary(): void {
    if (this.summaryLoading) return;
    this.summaryLoading = true;
    this.summaryError = '';

    this.http.get<DashboardData>(`${environment.apiBaseUrl}/dashboard`).pipe(
      timeout(HTTP_TIMEOUT_MS),
      catchError((err: ApiError) => {
        this.summaryError = this.userMessage(err, 'Failed to load dashboard data');
        return of(null);
      }),
      finalize(() => {
        this.summaryLoading = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe(data => {
      if (data) this.summary.set(data);
      this.cdr.markForCheck();
    });
  }

  // ---------------- Change password ----------------
  changePassword(): void {
    const u = this.user();
    if (!u) {
      this.setPwResult(false, 'You are not logged in. Please log in again.');
      return;
    }

    const pwd = this.newPassword;
    const confirm = this.confirmPassword;

    if (!pwd || pwd.length < MIN_PASSWORD_LEN) {
      this.setPwResult(false, `Password must be at least ${MIN_PASSWORD_LEN} characters.`);
      return;
    }
    if (pwd !== confirm) {
      this.setPwResult(false, 'Passwords do not match.');
      return;
    }
    if (this.pwLoading) return;

    this.pwMessage = '';
    this.pwSuccess = false;
    this.pwLoading = true;
    this.cdr.markForCheck();

    this.http.patch(
      `${environment.apiBaseUrl}/users/${u.userID}/password`,
      { newPassword: pwd }
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      catchError((err: ApiError) => {
        this.setPwResult(false, this.userMessage(err, 'Failed to update password.'));
        return of(null);
      }),
      finalize(() => {
        this.pwLoading = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      if (res !== null) {
        this.setPwResult(true, 'Password updated successfully.');
        this.newPassword = '';
        this.confirmPassword = '';
      }
      this.cdr.markForCheck();
    });
  }

  private setPwResult(success: boolean, msg: string): void {
    this.pwSuccess = success;
    this.pwMessage = msg;
    this.cdr.markForCheck();
  }

  // ---------------- Navigation ----------------
  goToCompanySettings(): void {
    this.router.navigateByUrl('/my-company-settings');
  }
  goToBilling(): void {
    this.router.navigateByUrl('/billing');
  }
  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  // ---------------- TrackBy ----------------
  trackByBatch(_: number, b: ExpiringBatch): number { return b.batchID; }
  trackByProduct(_: number, i: LowStockItem): number { return i.productID; }

  // ---------------- Helpers ----------------
  private userMessage(err: ApiError, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Network error — check your connection.';
      if (err.status === 401) return 'Session expired. Please sign in again.';
      if (err.status === 403) return 'You do not have permission for this action.';
      if (err.status === 408) return 'Request timed out. Please try again.';
      if (err.status >= 500) return 'Server error. Please try again shortly.';
      return (err.error?.message as string) || fallback;
    }
    if (err?.name === 'TimeoutError') return 'Request timed out. Please try again.';
    return (err?.message as string) || fallback;
  }

  private logError(context: string, err: unknown): void {
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.error(`[Dashboard] ${context}`, err);
    }
  }
}