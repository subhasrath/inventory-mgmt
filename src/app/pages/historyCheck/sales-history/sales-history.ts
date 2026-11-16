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
  finalize, takeUntil, timeout, map
} from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { Invoice } from '../../../models/api.model';

interface CustomerSuggestion {
  customerID?: number;
  fullName: string;
  gstin?: string;
  state?: string;
  mobile?: string;
}

type ApiError = HttpErrorResponse | { name: string; message?: string };

interface SearchCriteria {
  q: string;
  from: string;
  to: string;
}

const HTTP_TIMEOUT_MS = 20_000;
const SEARCH_DEBOUNCE_MS = 250;
const SUGGESTION_HIDE_DELAY_MS = 150;
const PDF_BLOB_TTL_MS = 60_000;

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-sales-history',
  styleUrl: './sales-history.css',
  templateUrl: './sales-history.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SalesHistory implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  // filters
  q = '';
  from = '';
  to = '';

  // data
  invoices: Invoice[] = [];
  loading = false;
  error = '';

  // autocomplete
  suggestions: CustomerSuggestion[] = [];
  showSuggestions = false;
  private suggestionHideTimer: ReturnType<typeof setTimeout> | null = null;

  // PDF
  pdfLoading = false;

  // lifecycle
  private destroy$ = new Subject<void>();

  /** Debounced search criteria stream. */
  private search$ = new Subject<SearchCriteria>();

  /** Debounced autocomplete term stream (independent from search). */
  private autocomplete$ = new Subject<string>();

  ngOnInit(): void {
    const today = new Date();
    const thirtyAgo = new Date();
    thirtyAgo.setDate(today.getDate() - 30);
    this.from = this.toIsoDate(thirtyAgo);
    this.to = this.toIsoDate(today);

    // ---- search pipeline ----
    this.search$.pipe(
      debounceTime(SEARCH_DEBOUNCE_MS),
      distinctUntilChanged((a, b) =>
        a.q === b.q && a.from === b.from && a.to === b.to),
      switchMap(criteria => {
        this.loading = true;
        this.error = '';
        this.cdr.markForCheck();

        return this.http.get<Invoice[]>(
          `${environment.apiBaseUrl}/invoices/search`,
          { params: this.toParams(criteria, /* includeQ */ true) }
        ).pipe(
          timeout(HTTP_TIMEOUT_MS),
          catchError((err: ApiError) => {
            this.error = this.userMessage(err, 'Search failed');
            return of([] as Invoice[]);
          }),
          finalize(() => {
            this.loading = false;
            this.cdr.markForCheck();
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(list => {
      this.invoices = list;
      this.cdr.markForCheck();
    });

    // ---- autocomplete pipeline ----
    this.autocomplete$.pipe(
      debounceTime(SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap(term => {
        if (!term) {
          this.suggestions = [];
          this.showSuggestions = false;
          this.cdr.markForCheck();
          return of([] as CustomerSuggestion[]);
        }
        return this.http.get<CustomerSuggestion[]>(
          `${environment.apiBaseUrl}/customers/walkin-search`,
          { params: new HttpParams().set('q', term) }
        ).pipe(
          timeout(HTTP_TIMEOUT_MS),
          catchError((err: ApiError) => {
            this.logError('autocomplete', err);
            return of([] as CustomerSuggestion[]);
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(list => {
      this.suggestions = (list || []).slice(0, 8);
      this.showSuggestions = this.suggestions.length > 0;
      this.cdr.markForCheck();
    });

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
  }

  reload(): void {
    this.autocomplete$.next('');
    this.triggerSearch();
  }

  clear(): void {
    this.q = '';
    const today = new Date();
    const thirtyAgo = new Date();
    thirtyAgo.setDate(today.getDate() - 30);
    this.from = this.toIsoDate(thirtyAgo);
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
  pickSuggestion(s: CustomerSuggestion): void {
    this.q = s.fullName ?? '';
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

  // ---------------- PDF ----------------
  printPdf(inv: Invoice): void {
    this.openPdf(inv, 'print');
  }

  downloadPdf(inv: Invoice): void {
    this.openPdf(inv, 'download');
  }

  private openPdf(inv: Invoice, mode: 'print' | 'download'): void {
    if (!inv?.invoiceID || this.pdfLoading) return;

    this.pdfLoading = true;
    this.error = '';
    this.cdr.markForCheck();

    this.http.get(
      `${environment.apiBaseUrl}/invoices/${inv.invoiceID}/pdf`,
      { responseType: 'blob' }
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      finalize(() => {
        this.pdfLoading = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (blob: Blob) => {
        if (!blob || blob.size === 0) {
          this.error = 'Server returned an empty PDF.';
          this.cdr.markForCheck();
          return;
        }
        const url = URL.createObjectURL(blob);

        if (mode === 'print') {
          const win = window.open(url, '_blank', 'noopener,noreferrer');
          if (!win) {
            this.error = 'Popup blocked — please allow popups for this site.';
            URL.revokeObjectURL(url);
            this.cdr.markForCheck();
            return;
          }
          setTimeout(() => URL.revokeObjectURL(url), PDF_BLOB_TTL_MS);
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = `${this.safeFilename(inv.invoiceNo) || 'invoice'}.pdf`;
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1_000);
        }
      },
      error: (err: ApiError) => {
        this.error = this.userMessage(err, 'Failed to load PDF');
        this.cdr.markForCheck();
      }
    });
  }

  // ---------------- Totals ----------------
  get totalSales(): number {
    return this.round2(this.invoices.reduce((s, i) => s + Number(i.grandTotal ?? 0), 0));
  }
  get totalTax(): number {
    return this.round2(this.invoices.reduce(
      (s, i) => s + Number(i.cgst ?? 0) + Number(i.sgst ?? 0) + Number(i.igst ?? 0), 0
    ));
  }
  get canUseActions(): boolean {
    return !this.pdfLoading && !this.loading;
  }

  // ---------------- TrackBy ----------------
  trackByInvoice(_: number, inv: Invoice): number | string {
    return inv.invoiceID ?? inv.invoiceNo ?? _;
  }
  trackBySuggestion(_: number, s: CustomerSuggestion): number | string {
    return s.customerID ?? s.gstin ?? s.mobile ?? s.fullName;
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
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private round2(n: number): number {
    return +Number(n || 0).toFixed(2);
  }

  private safeFilename(s: string | undefined | null): string {
    return (s ?? '').replace(/[^a-z0-9._-]/gi, '_').slice(0, 100);
  }

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
      console.error(`[SalesHistory] ${context}`, err);
    }
  }
}