import {
  ChangeDetectorRef, Component, OnDestroy, OnInit,
  inject, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subject, of } from 'rxjs';
import {
  debounceTime, distinctUntilChanged, switchMap, catchError,
  finalize, takeUntil, timeout
} from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { Vendor } from '../../../models/api.model';

type ApiError = HttpErrorResponse | { name: string; message?: string };

interface VendorForm {
  fullName: string;
  gstin: string;
  mobile: string;
  phone2: string;
  email: string;
  address: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
}

const HTTP_TIMEOUT_MS = 15_000;
const SEARCH_DEBOUNCE_MS = 250;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const PIN_RE = /^\d{6}$/;

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-vendors',
  styleUrl: './vendors.css',
  templateUrl: './vendors.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Vendors implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  // list
  vendors: Vendor[] = [];
  listLoading = false;
  listError = '';

  // search
  search = '';
  private search$ = new Subject<string>();

  // form
  form: VendorForm = this.empty();
  editing = false;
  editingId: number | null = null;
  saving = false;
  message = '';
  success = false;

  // deactivate
  pendingDeactivate: Vendor | null = null;
  deactivating = false;

  // lifecycle
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.search$.pipe(
      debounceTime(SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap(q => {
        this.listLoading = true;
        this.listError = '';
        this.cdr.markForCheck();
        return this.fetchVendors(q).pipe(
          finalize(() => {
            this.listLoading = false;
            this.cdr.markForCheck();
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(list => {
      this.vendors = list;
      this.cdr.markForCheck();
    });

    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ---------------- Data ----------------
  load(): void {
    this.search$.next(this.search.trim());
  }

  onSearch(): void {
    this.search$.next(this.search.trim());
  }

  private fetchVendors(q: string) {
    let params = new HttpParams();
    if (q) params = params.set('q', q);
    return this.http.get<Vendor[]>(
      `${environment.apiBaseUrl}/vendors`,
      { params }
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      catchError((err: ApiError) => {
        this.listError = this.userMessage(err, 'Failed to load vendors');
        return of([] as Vendor[]);
      })
    );
  }

  // ---------------- Form ----------------
  private empty(): VendorForm {
    return {
      fullName: '',
      gstin: '',
      mobile: '',
      phone2: '',
      email: '',
      address: '',
      city: '',
      district: '',
      state: '',
      pincode: '',
    };
  }

  save(): void {
    this.message = '';
    this.success = false;

    const err = this.validate();
    if (err) {
      this.fail(err);
      return;
    }
    if (this.saving) return;

    this.saving = true;
    this.cdr.markForCheck();

    const body = this.toPayload();

    const req = this.editing && this.editingId
      ? this.http.put<Vendor>(`${environment.apiBaseUrl}/vendors/${this.editingId}`, body)
      : this.http.post<Vendor>(`${environment.apiBaseUrl}/vendors`, body);

    req.pipe(
      timeout(HTTP_TIMEOUT_MS),
      finalize(() => {
        this.saving = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.success = true;
        this.message = this.editing ? 'Vendor updated.' : 'Vendor added.';
        this.resetForm(/* keepMessage */ true);
        this.load();
      },
      error: (err2: ApiError) => {
        this.success = false;
        this.message = this.userMessage(err2, 'Save failed');
      },
    });
  }

  edit(v: Vendor): void {
    if (!v.vendorID) return;
    this.form = {
      fullName: v.fullName ?? '',
      gstin: v.gstin ?? '',
      mobile: v.mobile ?? '',
      phone2: v.phone2 ?? '',
      email: v.email ?? '',
      address: v.address ?? '',
      city: v.city ?? '',
      district: v.district ?? '',
      state: v.state ?? '',
      pincode: v.pincode ?? '',
    };
    this.editing = true;
    this.editingId = v.vendorID;
    this.message = '';
    this.success = false;
    this.cdr.markForCheck();
  }

  cancel(): void {
    this.resetForm(false);
  }

  private resetForm(keepMessage: boolean): void {
    this.form = this.empty();
    this.editing = false;
    this.editingId = null;
    if (!keepMessage) {
      this.message = '';
      this.success = false;
    }
    this.cdr.markForCheck();
  }

  private toPayload(): Partial<Vendor> {
    const f = this.form;
    return {
      fullName: f.fullName.trim(),
      gstin: f.gstin.trim().toUpperCase() || undefined,
      mobile: f.mobile.trim(),
      phone2: f.phone2.trim() || undefined,
      email: f.email.trim() || undefined,
      address: f.address.trim(),
      city: f.city.trim() || undefined,
      district: f.district.trim() || undefined,
      state: f.state.trim(),
      pincode: f.pincode.trim() || undefined,
    };
  }

  private validate(): string | null {
    const f = this.form;
    if (!f.fullName?.trim()) return 'Vendor name is required.';
    if (f.fullName.trim().length > 120) return 'Name must be ≤ 120 characters.';
    if (!f.mobile?.trim()) return 'Mobile is required.';
    if (!MOBILE_RE.test(f.mobile.trim())) {
      return 'Enter a valid 10-digit Indian mobile number (starting 6–9).';
    }
    if (f.phone2 && f.phone2.trim() && !/^[\d\s+\-()]{6,20}$/.test(f.phone2.trim())) {
      return 'Alternate phone format looks invalid.';
    }
    if (f.email && f.email.trim()) {
      // simple email check; backend is authoritative
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
      if (!ok) return 'Email format looks invalid.';
    }
    if (!f.address?.trim()) return 'Address is required.';
    if (f.address.trim().length > 250) return 'Address must be ≤ 250 characters.';
    if (!f.state?.trim()) return 'State is required.';
    if (f.gstin && f.gstin.trim()) {
      if (!GSTIN_RE.test(f.gstin.trim().toUpperCase())) {
        return 'GSTIN format looks invalid (expected 15-character GSTIN).';
      }
    }
    if (f.pincode && f.pincode.trim() && !PIN_RE.test(f.pincode.trim())) {
      return 'Pincode must be 6 digits.';
    }
    return null;
  }

  // ---------------- Status ----------------
  requestDeactivate(v: Vendor): void {
    this.pendingDeactivate = v;
    this.cdr.markForCheck();
  }

  cancelDeactivate(): void {
    this.pendingDeactivate = null;
    this.cdr.markForCheck();
  }

  confirmDeactivate(): void {
    const v = this.pendingDeactivate;
    if (!v?.vendorID || this.deactivating) return;

    this.deactivating = true;
    this.cdr.markForCheck();

    this.http.delete(`${environment.apiBaseUrl}/vendors/${v.vendorID}`).pipe(
      timeout(HTTP_TIMEOUT_MS),
      finalize(() => {
        this.deactivating = false;
        this.pendingDeactivate = null;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.success = true;
        this.message = `${v.fullName} deactivated.`;
        this.load();
      },
      error: (err: ApiError) => {
        this.success = false;
        this.message = this.userMessage(err, 'Deactivate failed');
      },
    });
  }

  activate(v: Vendor): void {
    if (!v.vendorID || this.deactivating) return;

    this.deactivating = true;
    this.cdr.markForCheck();

    this.http.patch<Vendor>(
      `${environment.apiBaseUrl}/vendors/${v.vendorID}/status`,
      { status: 'Active' }
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      finalize(() => {
        this.deactivating = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.success = true;
        this.message = `${v.fullName} activated.`;
        this.load();
      },
      error: (err: ApiError) => {
        this.success = false;
        this.message = this.userMessage(err, 'Activate failed');
      },
    });
  }

  // ---------------- TrackBy ----------------
  trackByVendor(_: number, v: Vendor): number | string {
    return v.vendorID ?? v.gstin ?? v.fullName ?? _;
  }

  // ---------------- Helpers ----------------
  private fail(msg: string): void {
    this.success = false;
    this.message = msg;
    this.cdr.markForCheck();
  }

  private userMessage(err: ApiError, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Network error — check your connection.';
      if (err.status === 401) return 'Session expired. Please sign in again.';
      if (err.status === 403) return 'You do not have permission for this action.';
      if (err.status === 408) return 'Request timed out. Please try again.';
      if (err.status === 409) return 'A vendor with that GSTIN or mobile already exists.';
      if (err.status === 422) return (err.error?.message as string) || 'Invalid data.';
      if (err.status >= 500) return 'Server error. Please try again shortly.';
      return (err.error?.message as string) || fallback;
    }
    if (err?.name === 'TimeoutError') return 'Request timed out. Please try again.';
    return (err?.message as string) || fallback;
  }
}