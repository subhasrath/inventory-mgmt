import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subject, of } from 'rxjs';
import { debounceTime, switchMap, catchError, finalize } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

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

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-purchase-history',
  styleUrl: './purchase-history.css',
  templateUrl: './purchase-history.html',
})
export class PurchaseHistory implements OnInit, OnDestroy{
  private http = inject(HttpClient);
  private cdr  = inject(ChangeDetectorRef);

  q = '';
  from = '';
  to = '';

  purchases: Purchase[] = [];
  loading = false;
  error = '';

  suggestions: VendorSuggestion[] = [];
  showSuggestions = false;
  private searchInput$ = new Subject<string>();
  private sub: any;

  exporting = false;

  viewMode: 'detail' | 'summary' = 'detail';
summary: VendorSummary[] = [];
summaryLoading = false;

  ngOnInit() {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    this.from = oneYearAgo.toISOString().slice(0, 10);
    this.to   = today.toISOString().slice(0, 10);

    this.sub = this.searchInput$.pipe(
      debounceTime(250),
      switchMap(term => {
        // autocomplete suggestion fetch
        if (term && term.length >= 1) {
          this.http.get<VendorSuggestion[]>(
            `${environment.apiBaseUrl}/vendors?q=${encodeURIComponent(term)}`
          ).pipe(catchError(() => of([]))).subscribe(list => {
            this.suggestions = (list || []).slice(0, 8);
            this.showSuggestions = this.suggestions.length > 0;
            this.cdr.markForCheck();
          });
        } else {
          this.suggestions = [];
          this.showSuggestions = false;
        }

        return this.http.get<Purchase[]>(this.buildUrl(term)).pipe(
          catchError(err => {
            this.error = err.error?.message ?? 'Search failed';
            return of([]);
          }),
          finalize(() => {
            this.loading = false;
            this.cdr.markForCheck();
          })
        );
      })
    ).subscribe(list => {
      this.purchases = list;
      this.cdr.markForCheck();
    });

    this.reload();
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  private buildUrl(term: string): string {
    const params: string[] = [];
    if (term)      params.push(`q=${encodeURIComponent(term)}`);
    if (this.from) params.push(`from=${this.from}`);
    if (this.to)   params.push(`to=${this.to}`);
    return `${environment.apiBaseUrl}/purchases/search?${params.join('&')}`;
  }

  onSearchInput() {
    this.loading = true;
    this.error = '';
    this.searchInput$.next(this.q.trim());
  }

  pickSuggestion(s: VendorSuggestion) {
    this.q = s.fullName;
    this.suggestions = [];
    this.showSuggestions = false;
    this.loading = true;
    this.searchInput$.next(this.q);
    this.cdr.markForCheck();
  }

  hideSuggestionsLater() {
    setTimeout(() => { this.showSuggestions = false; this.cdr.markForCheck(); }, 150);
  }

  onDateChange() {
    this.loading = true;
    this.error = '';
    this.searchInput$.next(this.q.trim());
    if (this.viewMode === 'summary') {
    this.loadSummary();
  }
  }

  reload() {
    this.loading = true;
    this.error = '';
    this.searchInput$.next(this.q.trim());
  }

  clear() {
    this.q = '';
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    this.from = oneYearAgo.toISOString().slice(0, 10);
    this.to   = today.toISOString().slice(0, 10);
    this.suggestions = [];
    this.showSuggestions = false;
    this.reload();
  }

  exportCsv() {
    this.exporting = true;
    this.error = '';
    const params: string[] = [];
    if (this.q?.trim()) params.push(`q=${encodeURIComponent(this.q.trim())}`);
    if (this.from)      params.push(`from=${this.from}`);
    if (this.to)        params.push(`to=${this.to}`);

    this.http.get(
      `${environment.apiBaseUrl}/purchases/export/csv?${params.join('&')}`,
      { responseType: 'blob' }
    ).subscribe({
      next: blob => {
        this.exporting = false;
        this.saveBlob(blob, `vendor-purchases-${this.from}-to-${this.to}.csv`);
        this.cdr.markForCheck();
      },
      error: err => {
        this.exporting = false;
        this.error = err.error?.message ?? 'CSV export failed';
        this.cdr.markForCheck();
      }
    });
  }

  loadSummary() {
  this.summaryLoading = true;
  this.error = '';
  const params: string[] = [];
  if (this.from) params.push(`from=${this.from}`);
  if (this.to)   params.push(`to=${this.to}`);

  this.http.get<VendorSummary[]>(
    `${environment.apiBaseUrl}/purchases/summary/vendors?${params.join('&')}`
  ).subscribe({
    next: list => {
      this.summary = list;
      this.summaryLoading = false;
      this.cdr.markForCheck();
    },
    error: err => {
      this.summaryLoading = false;
      this.error = err.error?.message ?? 'Failed to load summary';
      this.cdr.markForCheck();
    }
  });
}

switchView(mode: 'detail' | 'summary') {
  this.viewMode = mode;
  if (mode === 'summary' && this.summary.length === 0) {
    this.loadSummary();
  }
  this.cdr.markForCheck();
}

exportSummaryCsv() {
  this.exporting = true;
  this.error = '';
  const params: string[] = [];
  if (this.from) params.push(`from=${this.from}`);
  if (this.to)   params.push(`to=${this.to}`);

  this.http.get(
    `${environment.apiBaseUrl}/purchases/summary/vendors/export/csv?${params.join('&')}`,
    { responseType: 'blob' }
  ).subscribe({
    next: blob => {
      this.exporting = false;
      this.saveBlob(blob, `vendor-summary-${this.from}-to-${this.to}.csv`);
      this.cdr.markForCheck();
    },
    error: err => {
      this.exporting = false;
      this.error = err.error?.message ?? 'CSV export failed';
      this.cdr.markForCheck();
    }
  });
}

exportSummaryPdf() {
  this.exporting = true;
  this.error = '';
  const params: string[] = [];
  if (this.from) params.push(`from=${this.from}`);
  if (this.to)   params.push(`to=${this.to}`);

  this.http.get(
    `${environment.apiBaseUrl}/purchases/summary/vendors/export/pdf?${params.join('&')}`,
    { responseType: 'blob' }
  ).subscribe({
    next: blob => {
      this.exporting = false;
      this.saveBlob(blob, `vendor-summary-${this.from}-to-${this.to}.pdf`);
      this.cdr.markForCheck();
    },
    error: err => {
      this.exporting = false;
      this.error = err.error?.message ?? 'PDF export failed';
      this.cdr.markForCheck();
    }
  });
}

// summary getters
get summaryTotalTaxable(): number {
  return +this.summary.reduce((s, r) => s + Number(r.subTotal ?? 0), 0).toFixed(2);
}
get summaryTotalITC(): number {
  return +this.summary.reduce((s, r) => s + Number(r.totalTax ?? 0), 0).toFixed(2);
}
get summaryGrandTotal(): number {
  return +this.summary.reduce((s, r) => s + Number(r.grandTotal ?? 0), 0).toFixed(2);
}

  exportPdf() {
    this.exporting = true;
    this.error = '';
    const params: string[] = [];
    if (this.q?.trim()) params.push(`q=${encodeURIComponent(this.q.trim())}`);
    if (this.from)      params.push(`from=${this.from}`);
    if (this.to)        params.push(`to=${this.to}`);

    this.http.get(
      `${environment.apiBaseUrl}/purchases/export/pdf?${params.join('&')}`,
      { responseType: 'blob' }
    ).subscribe({
      next: blob => {
        this.exporting = false;
        this.saveBlob(blob, `vendor-purchases-${this.from}-to-${this.to}.pdf`);
        this.cdr.markForCheck();
      },
      error: err => {
        this.exporting = false;
        this.error = err.error?.message ?? 'PDF export failed';
        this.cdr.markForCheck();
      }
    });
  }

  private saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  get totalValue(): number {
    return +this.purchases.reduce((s, p) => s + Number(p.grandTotal ?? 0), 0).toFixed(2);
  }
  get totalTax(): number {
    return +this.purchases.reduce(
      (s, p) => s + Number(p.cgst ?? 0) + Number(p.sgst ?? 0) + Number(p.igst ?? 0), 0
    ).toFixed(2);
  }
  get totalLineItems(): number {
    return this.purchases.reduce((s, p) => s + (p.items?.length ?? 0), 0);
  }
}
