import { ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Auth } from '../../services/auth';

interface DashboardData {
  todaySales: number;
  todayInvoiceCount: number;
  expiringBatches: Array<{
    batchID: number;
    productID: number;
    itemName: string;
    batchNo: string;
    expiryDate: string;
    qtyBalance: number;
  }>;
  lowStockItems: Array<{
    productID: number;
    itemName: string;
    currentStock: number;
    reorderLevel: number;
  }>;
}

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-dashboard',
  styleUrl: './dashboard.css',
  templateUrl: './dashboard.html',
})
export class Dashboard implements OnInit {
  private http  = inject(HttpClient);
  private auth  = inject(Auth);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);        // ← add
  user = this.auth.user;

  // ---- password change ----
  newPassword = '';
  confirmPassword = '';
  pwLoading = false;
  pwMessage = '';
  pwSuccess = false;

  // ---- dashboard summary ----
  summary = signal<DashboardData | null>(null);
  summaryLoading = false;
  summaryError = '';

  // ---- company config check ----
  companyConfigured = signal<boolean>(true);

  ngOnInit() {
    this.loadCompanyStatus();
    this.loadSummary();
  }

  private loadCompanyStatus() {
    this.http.get<{ configured: boolean }>(`${environment.apiBaseUrl}/company/configured`)
      .subscribe({
        next: res => this.companyConfigured.set(res.configured),
        error: () => this.companyConfigured.set(false),
      });
  }

  loadSummary() {
    this.summaryLoading = true;
    this.summaryError = '';

    this.http.get<DashboardData>(`${environment.apiBaseUrl}/dashboard`)
      .subscribe({
        next: data => {
          this.summary.set(data);
          this.summaryLoading = false;
          this.cdr.markForCheck();                 // ← add
        },
        error: err => {
          this.summaryLoading = false;
          this.summaryError = err.error?.message ?? 'Failed to load dashboard data';
          this.cdr.markForCheck();
        },
      });
  }

  // ---------------- change password ----------------
changePassword() {
    const u = this.user();
    if (!u) {
      this.pwMessage = 'You are not logged in. Please log in again.';
      this.pwSuccess = false;
      this.cdr.markForCheck();
      return;
    }

    this.pwMessage = '';
    this.pwSuccess = false;

    if (!this.newPassword || this.newPassword.length < 4) {
      this.pwMessage = 'Password must be at least 4 characters';
      this.cdr.markForCheck();
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.pwMessage = 'Passwords do not match';
      this.cdr.markForCheck();
      return;
    }

    this.pwLoading = true;
    this.cdr.markForCheck();                       // ← show spinner NOW

    this.http.patch(`${environment.apiBaseUrl}/users/${u.userID}/password`, {
      newPassword: this.newPassword,
    }).subscribe({
      next: () => {
        this.pwLoading = false;
        this.pwSuccess = true;
        this.pwMessage = 'Password updated successfully.';
        this.newPassword = '';
        this.confirmPassword = '';
        this.cdr.markForCheck();                   // ← render success
      },
      error: err => {
        this.pwLoading = false;
        this.pwSuccess = false;
        this.pwMessage = err.error?.message ?? 'Failed to update password.';
        this.cdr.markForCheck();                   // ← render error
      },
    });
  }

  // ---------------- actions ----------------
  goToCompanySettings() {
    this.router.navigateByUrl('/my-company-settings');
  }
  goToBilling() {
    this.router.navigateByUrl('/billing');
  }
  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
