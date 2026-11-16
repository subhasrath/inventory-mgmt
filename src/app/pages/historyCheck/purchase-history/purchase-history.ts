import {
  ChangeDetectorRef, Component, OnDestroy, OnInit,
  inject, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subject, of, merge } from 'rxjs';
import {
  debounceTime, distinctUntilChanged, switchMap, catchError,
  finalize, takeUntil, timeout, map
} from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

interface PurchaseItem {
  purchaseItemID?: number;
  productID?: number;
  batchID?: number;
  batchNo?: string;
  expiryDate?: string;
  quantity?: number;
  purchaseRate?: number;
  gstRate?: number;
  taxableValue?: number;
  taxAmount?: number;
  lineTotal?: number;
}

interface Purchase {
  purchaseID?: number;
  purchaseNo?: string;
  purchaseDate?: string;
  vendorID?: number;
  vendorName?: string;
  vendorBillNo?: string;
  subTotal?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  grandTotal?: number;
  items?: PurchaseItem[];
}

interface VendorSuggestion {
  vendorID?: number;
  fullName: string;
  gstin?: string;
  state?: string;
}

interface VendorSummary {
  vendorID?: number;
  vendorName?: string;
  gstin?: string;
  purchaseCount?: number;
  subTotal?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  totalTax?: number;
  grandTotal?: number;
}

type ApiError = HttpErrorResponse | { name: string; message?: string };
type ViewMode = 'detail' | 'summary';

interface SearchCriteria {
  q: string;
  from: string;
  to: string;
}

const HTTP_TIMEOUT_MS = 20_000;
const SEARCH_DEBOUNCE_MS = 250;
const SUGGESTION_HIDE_DELAY_MS = 150;
const BLOB_OBJECT_URL_TTL_MS = 1_000;

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-purchase-history',
  styleUrl: './purchase-history.css',
  templateUrl: './purchase-history.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PurchaseHistory implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  // filters
  q = '';
  from = '';
  to = '';

  // detail
  purchases: Purchase[] = [];
  loading = false;
  error = '';

  // autocomplete
  suggestions: VendorSuggestion[] = [];
  showSuggestions = false;
  private suggestionHideTimer: ReturnType<typeof setTimeout> | null = null;

  // view
  viewMode: ViewMode = 'detail';
  summary: VendorSummary[] = [];
  summaryLoading = false;
  private summaryDirty = true;

  // export
  exporting = false;

  // lifecycle
  private destroy$ = new Subject<void>();

  /** User-triggered search subject (debounced). */
  private search$ = new Subject<SearchCriteria>();

  /** Autocomplete subject — separate so it can be cancelled independently. */
  private autocomplete$ = new Subject<string>();

  ngOnInit(): void {
    // Set default 1-year range
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    this.from = this.toIsoDate(oneYearAgo);
    this.to = this.toIsoDate(today);

    // Wire search pipeline
    this.search$.pipe(
      debounceTime(SEARCH_DEBOUNCE_MS),
      distinctUntilChanged((a, b) => a.q === b.q && a.from === b.from && a.to === b.to),
      switchMap(criteria => {
        this.loading = true;
        this.error = '';
        this.cdr.markForCheck();

        return this.http.get<Purchase[]>(
          `${environment.apiBaseUrl}/purchases/search`,
          { params: this.toParams(criteria, /* includeQ */ true) }
        ).pipe(
          timeout(HTTP_TIMEOUT_MS),
          catchError((err: ApiError) => {
            this.error = this.userMessage(err, 'Search failed');
            return of([] as Purchase[]);
          }),
          finalize(() => {
            this.loading = false;
            this.cdr.markForCheck();
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(list => {
      this.purchases = list;
      this.summaryDirty = true; // criteria changed → summary stale
      this.cdr.markForCheck();
    });

    // Wire autocomplete pipeline
    this.autocomplete$.pipe(
      debounceTime(SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap(term => {
        if (!term) {
          this.suggestions = [];
          this.showSuggestions = false;
          this.cdr.markForCheck();
          return of([] as VendorSuggestion[]);
        }
        return this.http.get<VendorSuggestion[]>(
          `${environment.apiBaseUrl}/vendors`,
          { params: new HttpParams().set('q', term) }
        ).pipe(
          timeout(HTTP_TIMEOUT_MS),
          catchError((err: ApiError) => {
            this.logError('autocomplete', err);
            return of([] as VendorSuggestion[]);
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(list => {
      this.suggestions = (list || []).slice(0, 8);
      this.showSuggestions = this.suggestions.length > 0;
      this.cdr.markForCheck();
    });

    // Initial load
    this.reload();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.suggestionHideTimer) {
      clearTimeout(this.suggestionHideTimer);
      this.suggestionHideTimer = null;
    }
  }

  // ---------------- Search ----------------
  onSearchInput(): void {
    this.autocomplete$.next(this.q.trim());
    this.triggerSearch();
  }

  onDateChange(): void {
    if (this.isInvalidRange()) {
      this.error = '"From" date must be on or before "To" date.';
      this.cdr.markForCheck();
      return;
    }
    this.triggerSearch();
    if (this.viewMode === 'summary') this.loadSummary(true);
  }

  reload(): void {
    this.autocomplete$.next('');
    this.triggerSearch();
    if (this.viewMode === 'summary') this.loadSummary(true);
  }

  clear(): void {
    this.q = '';
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    this.from = this.toIsoDate(oneYearAgo);
    this.to = this.toIsoDate(today);
    this.suggestions = [];
    this.showSuggestions = false;
    this.reload();
  }

  private triggerSearch(): void {
    this.search$.next({
      q: this.q.trim(),
      from: this.from,
      to: this.to,
    });
  }

  private isInvalidRange(): boolean {
    if (!this.from || !this.to) return false;
    return this.from > this.to;
  }

  // ---------------- Autocomplete ----------------
  pickSuggestion(s: VendorSuggestion): void {
    this.q = s.fullName;
    this.suggestions = [];
    this.showSuggestions = false;
    this.triggerSearch();
    this.cdr.markForCheck();
  }

  hideSuggestionsLater(): void {
    if (this.suggestionHideTimer) clearTimeout(this.suggestionHideTimer);
    this.suggestionHideTimer = setTimeout(() => {
      this.showSuggestions = false;
      this.cdr.markForCheck();
    }, SUGGESTION_HIDE_DELAY_MS);
  }

  // ---------------- Summary ----------------
  switchView(mode: ViewMode): void {
    this.viewMode = mode;
    if (mode === 'summary' && (this.summary.length === 0 || this.summaryDirty)) {
      this.loadSummary(true);
    }
    this.cdr.markForCheck();
  }

  loadSummary(force = false): void {
    if (this.summaryLoading) return;
    if (!force && !this.summaryDirty && this.summary.length > 0) return;
    if (this.isInvalidRange()) {
      this.error = '"From" date must be on or before "To" date.';
      this.cdr.markForCheck();
      return;
    }

    this.summaryLoading = true;
    this.error = '';
    this.cdr.markForCheck();

    this.http.get<VendorSummary[]>(
      `${environment.apiBaseUrl}/purchases/summary/vendors`,
      { params: this.toParams({ q: '', from: this.from, to: this.to }, false) }
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      catchError((err: ApiError) => {
        this.error = this.userMessage(err, 'Failed to load summary');
        return of([] as VendorSummary[]);
      }),
      finalize(() => {
        this.summaryLoading = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe(list => {
      this.summary = list;
      this.summaryDirty = false;
      this.cdr.markForCheck();
    });
  }

  // ---------------- Exports ----------------
  exportCsv(): void { this.exportBlob('csv', 'detail'); }
  exportPdf(): void { this.exportBlob('pdf', 'detail'); }
  exportSummaryCsv(): void { this.exportBlob('csv', 'summary'); }
  exportSummaryPdf(): void { this.exportBlob('pdf', 'summary'); }

  private exportBlob(kind: 'csv' | 'pdf', scope: 'detail' | 'summary'): void {
    if (this.exporting) return;
    if (this.isInvalidRange()) {
      this.error = '"From" date must be on or before "To" date.';
      this.cdr.markForCheck();
      return;
    }

    this.exporting = true;
    this.error = '';
    this.cdr.markForCheck();

    const path = scope === 'detail'
      ? `/purchases/export/${kind}`
      : `/purchases/summary/vendors/export/${kind}`;
    const params = scope === 'detail'
      ? this.toParams({ q: this.q.trim(), from: this.from, to: this.to }, true)
      : this.toParams({ q: '', from: this.from, to: this.to }, false);

    this.http.get(
      `${environment.apiBaseUrl}${path}`,
      { params, responseType: 'blob' }
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      finalize(() => {
        this.exporting = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (blob: Blob) => {
        if (!blob || blob.size === 0) {
          this.error = 'Server returned an empty file.';
          this.cdr.markForCheck();
          return;
        }
        const prefix = scope === 'detail' ? 'vendor-purchases' : 'vendor-summary';
        const ext = kind === 'csv' ? 'csv' : 'pdf';
        this.saveBlob(blob, `${prefix}-${this.from}-to-${this.to}.${ext}`);
      },
      error: (err: ApiError) => {
        this.error = this.userMessage(err, `${kind.toUpperCase()} export failed`);
        this.cdr.markForCheck();
      }
    });
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), BLOB_OBJECT_URL_TTL_MS);
  }

  // ---------------- Totals ----------------
  get summaryTotalTaxable(): number {
    return this.round2(this.summary.reduce((s, r) => s + Number(r.subTotal ?? 0), 0));
  }
  get summaryTotalITC(): number {
    return this.round2(this.summary.reduce((s, r) => s + Number(r.totalTax ?? 0), 0));
  }
  get summaryGrandTotal(): number {
    return this.round2(this.summary.reduce((s, r) => s + Number(r.grandTotal ?? 0), 0));
  }
  get totalValue(): number {
    return this.round2(this.purchases.reduce((s, p) => s + Number(p.grandTotal ?? 0), 0));
  }
  get totalTax(): number {
    return this.round2(this.purchases.reduce(
      (s, p) => s + Number(p.cgst ?? 0) + Number(p.sgst ?? 0) + Number(p.igst ?? 0), 0
    ));
  }
  get totalLineItems(): number {
    return this.purchases.reduce((s, p) => s + (p.items?.length ?? 0), 0);
  }
  get canExportDetail(): boolean {
    return !this.exporting && !this.loading && this.purchases.length > 0;
  }
  get canExportSummary(): boolean {
    return !this.exporting && !this.summaryLoading && this.summary.length > 0;
  }

  // ---------------- TrackBy ----------------
  trackByPurchase(_: number, p: Purchase): number | string {
    return p.purchaseID ?? p.purchaseNo ?? _;
  }
  trackByVendorSummary(_: number, r: VendorSummary): number | string {
    return r.vendorID ?? r.gstin ?? r.vendorName ?? _;
  }
  trackByVendorSuggestion(_: number, s: VendorSuggestion): number | string {
    return s.vendorID ?? s.gstin ?? s.fullName;
  }

  // ---------------- Helpers ----------------
  private toParams(c: SearchCriteria, includeQ: boolean): HttpParams {
    let params = new HttpParams();
    if (includeQ && c.q) params = params.set('q', c.q);
    if (c.from) params = params.set('from', c.from);
    if (c.to) params = params.set('to', c.to);
    return params;
  }

  private toIsoDate(d: Date): string {
    // Use local date parts to avoid UTC offset surprises near midnight
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private round2(n: number): number {
    return +Number(n || 0).toFixed(2);
  }

  private userMessage(err: ApiError, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Network error — check your connection.';
      if (err.status === 401) return 'Session expired. Please sign in again.';
      if (err.status === 403) return 'You do not have permission for this action.';
      if (err.status === 408) return 'Request timed out. Please try again.';
      if (err.status === 413) return 'Result set too large — narrow your date range.';
      if (err.status >= 500) return 'Server error. Please try again shortly.';
      return (err.error?.message as string) || fallback;
    }
    if (err?.name === 'TimeoutError') return 'Request timed out. Please try again.';
    return (err?.message as string) || fallback;
  }

  private logError(context: string, err: unknown): void {
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.error(`[PurchaseHistory] ${context}`, err);
    }
  }
}