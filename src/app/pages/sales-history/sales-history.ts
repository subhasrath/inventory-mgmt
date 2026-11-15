import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subject, of } from 'rxjs';
import { debounceTime, switchMap, catchError, finalize } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Invoice } from '../../models/api.model';

interface CustomerSuggestion {
  customerID?: number;
  fullName: string;
  gstin?: string;
  state?: string;
  mobile?: string;
}

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-sales-history',
  styleUrl: './sales-history.css',
  templateUrl: './sales-history.html',
})
export class SalesHistory implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private cdr  = inject(ChangeDetectorRef);

  q = '';
  from = '';
  to = '';

  invoices: Invoice[] = [];
  loading = false;
  error = '';

  suggestions: CustomerSuggestion[] = [];
  showSuggestions = false;
  private searchInput$ = new Subject<string>();
  private sub: any;

  pdfLoading = false;

  ngOnInit() {
    const today = new Date();
    const thirtyAgo = new Date();
    thirtyAgo.setDate(today.getDate() - 30);
    this.from = thirtyAgo.toISOString().slice(0, 10);
    this.to   = today.toISOString().slice(0, 10);

    this.sub = this.searchInput$.pipe(
      debounceTime(250),
      switchMap(term => {
        if (term && term.length >= 1) {
          this.http.get<CustomerSuggestion[]>(
            `${environment.apiBaseUrl}/customers/walkin-search?q=${encodeURIComponent(term)}`
          ).pipe(catchError(() => of([]))).subscribe(list => {
            this.suggestions = list;
            this.showSuggestions = list.length > 0;
            this.cdr.markForCheck();
          });
        } else {
          this.suggestions = [];
          this.showSuggestions = false;
          this.cdr.markForCheck();
        }

        return this.http.get<Invoice[]>(this.buildUrl(term)).pipe(
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
      this.invoices = list;
      this.cdr.markForCheck();
    });

    this.reload();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  private buildUrl(term: string): string {
    const params: string[] = [];
    if (term)      params.push(`q=${encodeURIComponent(term)}`);
    if (this.from) params.push(`from=${this.from}`);
    if (this.to)   params.push(`to=${this.to}`);
    return `${environment.apiBaseUrl}/invoices/search?${params.join('&')}`;
  }

  onSearchInput() {
    this.loading = true;
    this.error = '';
    this.searchInput$.next(this.q.trim());
  }

  pickSuggestion(s: CustomerSuggestion) {
    this.q = s.fullName;
    this.suggestions = [];
    this.showSuggestions = false;
    this.loading = true;
    this.error = '';
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
  }

  reload() {
    this.loading = true;
    this.error = '';
    this.searchInput$.next(this.q.trim());
  }

  clear() {
    this.q = '';
    const today = new Date();
    const thirtyAgo = new Date();
    thirtyAgo.setDate(today.getDate() - 30);
    this.from = thirtyAgo.toISOString().slice(0, 10);
    this.to   = today.toISOString().slice(0, 10);
    this.suggestions = [];
    this.showSuggestions = false;
    this.reload();
  }

  printPdf(inv: Invoice) {
    if (!inv.invoiceID) return;
    this.pdfLoading = true;
    this.http.get(
      `${environment.apiBaseUrl}/invoices/${inv.invoiceID}/pdf`,
      { responseType: 'blob' }
    ).subscribe({
      next: blob => {
        this.pdfLoading = false;
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        this.cdr.markForCheck();
      },
      error: err => {
        this.pdfLoading = false;
        this.error = err.error?.message ?? 'Failed to load PDF';
        this.cdr.markForCheck();
      }
    });
  }

  downloadPdf(inv: Invoice) {
    if (!inv.invoiceID) return;
    this.pdfLoading = true;
    this.http.get(
      `${environment.apiBaseUrl}/invoices/${inv.invoiceID}/pdf`,
      { responseType: 'blob' }
    ).subscribe({
      next: blob => {
        this.pdfLoading = false;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${inv.invoiceNo || 'invoice'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.cdr.markForCheck();
      },
      error: err => {
        this.pdfLoading = false;
        this.error = err.error?.message ?? 'Failed to download PDF';
        this.cdr.markForCheck();
      }
    });
  }

  get totalSales(): number {
    return +this.invoices.reduce((s, i) => s + Number(i.grandTotal ?? 0), 0).toFixed(2);
  }
  get totalTax(): number {
    return +this.invoices.reduce(
      (s, i) => s + Number(i.cgst ?? 0) + Number(i.sgst ?? 0) + Number(i.igst ?? 0), 0
    ).toFixed(2);
  }
}