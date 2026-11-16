import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { Subject, takeUntil, finalize } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { NewCompany } from '../../../models/api.model';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-company',
  styleUrl: './company.css',
  templateUrl: './company.html',
})
export class Company implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  company: NewCompany = this.emptyCompany();

  // UI state
  loading = false;
  saving = false;
  message = '';
  success = false;
  fieldErrors: Partial<Record<keyof NewCompany, string>> = {};

  ngOnInit(): void {
    this.loadCompany();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private emptyCompany(): NewCompany {
    return {
      name: '', gstin: '', address: '', city: '', state: '',
      pincode: '', phone: '', email: '',
      invoicePrefix: 'INV', nextInvoiceNo: 1,
    };
  }

  private loadCompany(): void {
    this.loading = true;
    this.cdr.markForCheck();

    this.http.get<NewCompany | null>(`${environment.apiBaseUrl}/company`)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (existing) => {
          if (existing) {
            this.company = { ...this.emptyCompany(), ...existing };
          }
        },
        error: (err: HttpErrorResponse) => {
          // 404 on first-time setup is expected — not an error
          if (err.status !== 404) {
            this.success = false;
            this.message = this.extractError(err, 'Failed to load company details.');
          }
        },
      });
  }

  save(): void {
    if (this.saving) return;

    this.message = '';
    this.success = false;

    if (!this.validate()) return;

    this.saving = true;
    this.cdr.markForCheck();

    const payload: NewCompany = {
      ...this.company,
      name: this.company.name.trim(),
      gstin: this.company.gstin.trim().toUpperCase(),
      state: this.company.state.trim(),
      address: this.company.address?.trim() ?? '',
      city: this.company.city?.trim() ?? '',
      pincode: this.company.pincode?.trim() ?? '',
      phone: this.company.phone?.trim() ?? '',
      email: this.company.email?.trim() ?? '',
      invoicePrefix: (this.company.invoicePrefix?.trim() || 'INV'),
      nextInvoiceNo: Math.max(1, Math.floor(Number(this.company.nextInvoiceNo) || 1)),
    };

    this.http.post<NewCompany>(`${environment.apiBaseUrl}/company`, payload)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.saving = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => {
          this.company = payload;
          this.success = true;
          this.message = 'Company details saved.';
          setTimeout(() => {
            this.router.navigateByUrl('/dashboard').catch(() => { /* ignore */ });
          }, 1200);
        },
        error: (err: HttpErrorResponse) => {
          this.success = false;
          this.message = this.extractError(err, 'Save failed. Please try again.');
        },
      });
  }

  private validate(): boolean {
    this.fieldErrors = {};
    let ok = true;

    const name = this.company.name?.trim();
    if (!name) { this.fieldErrors.name = 'Shop name is required.'; ok = false; }

    const gstin = this.company.gstin?.trim();
    if (!gstin) {
      this.fieldErrors.gstin = 'GSTIN is required.';
      ok = false;
    } else if (!GSTIN_REGEX.test(gstin.toUpperCase())) {
      this.fieldErrors.gstin = 'Invalid GSTIN format (e.g. 27ABCDE1234F1Z5).';
      ok = false;
    }

    const state = this.company.state?.trim();
    if (!state) { this.fieldErrors.state = 'State is required.'; ok = false; }

    const email = this.company.email?.trim();
    if (email && !EMAIL_REGEX.test(email)) {
      this.fieldErrors.email = 'Invalid email address.';
      ok = false;
    }

    const pincode = this.company.pincode?.trim();
    if (pincode && !PINCODE_REGEX.test(pincode)) {
      this.fieldErrors.pincode = 'Pincode must be 6 digits.';
      ok = false;
    }

    const phone = this.company.phone?.trim();
    if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) {
      this.fieldErrors.phone = 'Invalid phone number.';
      ok = false;
    }

    if (!ok) {
      this.message = 'Please fix the highlighted fields.';
      this.cdr.markForCheck();
    }
    return ok;
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 0) return 'Network error. Check your connection.';
    if (err.status === 401 || err.status === 403) return 'Not authorized.';
    const serverMsg = (err.error && typeof err.error === 'object')
      ? (err.error.message ?? err.error.error)
      : null;
    return typeof serverMsg === 'string' && serverMsg.trim() ? serverMsg : fallback;
  }

  fieldInvalid(field: keyof NewCompany): boolean {
    return !!this.fieldErrors[field];
  }
}