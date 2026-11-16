import {
  Component, OnInit, AfterViewInit, OnDestroy,
  ElementRef, ViewChild, inject, ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, of } from 'rxjs';
import {
  debounceTime, distinctUntilChanged, switchMap, catchError,
  takeUntil, timeout, finalize, tap
} from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Item, Customer, Invoice } from '../../models/api.model';

type ApiError = HttpErrorResponse | { name: string; message?: string };

interface CartLine {
  productID: number;
  itemName: string;
  batchNo?: string;
  expiryDate?: string;
  hsnCode?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  gstRate: number;
  taxableValue: number;
  taxAmount: number;
  lineTotal: number;
}

const HTTP_TIMEOUT_MS = 15_000;
const FOCUS_INTERVAL_MS = 1_500;
const SEARCH_DEBOUNCE_MS = 250;
const SUGGESTION_HIDE_DELAY_MS = 150;
const PDF_BLOB_TTL_MS = 60_000;

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-billing',
  styleUrl: './billing.css',
  templateUrl: './billing.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Billing implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('barcodeInput') barcodeInput!: ElementRef<HTMLInputElement>;

  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  // lifecycle / cleanup
  private destroy$ = new Subject<void>();
  private subs = new Subscription();
  private barcodeFocusTimer: ReturnType<typeof setInterval> | null = null;
  private suggestionHideTimer: ReturnType<typeof setTimeout> | null = null;
  private customerSearch$ = new Subject<string>();

  // scanner
  barcode = '';
  barcodeError = '';
  scanning = false;

  // customer
  customerName = '';
  customerGstin = '';
  customerMobile = '';
  customerState = 'Maharashtra';
  suggestions: Customer[] = [];
  showSuggestions = false;
  searchingCustomers = false;

  // cart
  cart: CartLine[] = [];

  // meta
  paymentMode: 'CASH' | 'CARD' | 'UPI' | 'CREDIT' = 'CASH';

  // state
  saving = false;
  error = '';
  lastInvoice: Invoice | null = null;
  downloadingPdf = false;
  printingPdf = false;

  // company state for CGST/SGST vs IGST
  companyState = 'Maharashtra';

  

  ngOnInit(): void {
    this.loadCompany();

    // Debounced customer search
    this.subs.add(
      this.customerSearch$.pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        tap(() => { this.searchingCustomers = true; this.cdr.markForCheck(); }),
        switchMap(q =>
          this.http.get<Customer[]>(
            `${environment.apiBaseUrl}/customers/walkin-search`,
            { params: { q } }
          ).pipe(
            timeout(HTTP_TIMEOUT_MS),
            catchError(err => {
              this.handleSilentError('Customer search failed', err);
              return of([] as Customer[]);
            }),
            finalize(() => { this.searchingCustomers = false; this.cdr.markForCheck(); })
          )
        ),
        takeUntil(this.destroy$)
      ).subscribe(list => {
        this.suggestions = list;
        this.showSuggestions = list.length > 0;
        this.cdr.markForCheck();
      })
    );
  }

  ngAfterViewInit(): void {
    this.focusBarcode();
    this.barcodeFocusTimer = setInterval(() => this.refocusIfIdle(), FOCUS_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.subs.unsubscribe();
    if (this.barcodeFocusTimer) {
      clearInterval(this.barcodeFocusTimer);
      this.barcodeFocusTimer = null;
    }
    if (this.suggestionHideTimer) {
      clearTimeout(this.suggestionHideTimer);
      this.suggestionHideTimer = null;
    }
  }

  // ---------------- Bootstrap ----------------
  private loadCompany(): void {
    this.subs.add(
      this.http.get<any>(`${environment.apiBaseUrl}/company`).pipe(
        timeout(HTTP_TIMEOUT_MS),
        catchError(err => {
          this.handleSilentError('Failed to load company profile', err);
          return of(null);
        }),
        takeUntil(this.destroy$)
      ).subscribe(c => {
        if (c?.state) {
          this.companyState = String(c.state);
          this.customerState = this.companyState;
        }
        this.cdr.markForCheck();
      })
    );
  }

  // ---------------- Focus management ----------------
  private refocusIfIdle(): void {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) { this.focusBarcode(); return; }

    const tag = el.tagName;
    const isBarcode = el === this.barcodeInput?.nativeElement;
    if (isBarcode) return;

    const isEditable =
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      (el as HTMLElement).isContentEditable;

    if (!isEditable) this.focusBarcode();
  }

  focusBarcode(): void {
    // setTimeout deferred so it runs after any in-flight CD
    setTimeout(() => {
      const input = this.barcodeInput?.nativeElement;
      if (input && document.activeElement !== input) input.focus();
    }, 50);
  }

  // ---------------- Scanner ----------------
  onBarcodeEnter(): void {
    const code = (this.barcode || '').trim();
    this.barcode = '';
    this.barcodeError = '';
    if (!code) return;

    if (this.scanning) return; // ignore rapid double-scans
    this.scanning = true;
    this.cdr.markForCheck();

    this.subs.add(
      this.http.get<Item>(
        `${environment.apiBaseUrl}/items/barcode/${encodeURIComponent(code)}`
      ).pipe(
        timeout(HTTP_TIMEOUT_MS),
        finalize(() => { this.scanning = false; this.cdr.markForCheck(); }),
        takeUntil(this.destroy$)
      ).subscribe({
        next: item => {
          if (!item || !item.productID) {
            this.barcodeError = `Item data invalid for barcode "${code}"`;
          } else {
            this.addToCart(item);
          }
          this.focusBarcode();
        },
 error: (err: ApiError) => {
  this.barcodeError =
    err instanceof HttpErrorResponse && err.status === 404
      ? `No item for barcode "${code}"`
      : this.userMessage(err, 'Failed to look up barcode');
  this.focusBarcode();
}

      })
    );
  }

  // ---------------- Cart ----------------
  addToCart(item: Item): void {
    if (!item || !item.productID) return;

    const existing = this.cart.find(l => l.productID === item.productID);
    if (existing) {
      existing.quantity = Math.max(1, existing.quantity + 1);
      this.recalc(existing);
    } else {
      const line: CartLine = {
        productID: item.productID,
        itemName: item.itemName ?? 'Unnamed item',
        hsnCode: item.hsnCode,
        quantity: 1,
        unitPrice: Math.max(0, Number(item.unitPrice ?? 0)),
        discount: this.clamp(Number(item.discount ?? 0), 0, 100),
        gstRate: Math.max(0, Number(item.gstRate ?? 0)),
        taxableValue: 0,
        taxAmount: 0,
        lineTotal: 0
      };
      this.recalc(line);
      this.cart = [...this.cart, line]; // new ref for OnPush
    }
    this.cdr.markForCheck();
    this.focusBarcode();
  }

  recalc(line: CartLine): void {
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
    line.quantity = qty;
    const price = Math.max(0, Number(line.unitPrice) || 0);
    const discPct = this.clamp(Number(line.discount) || 0, 0, 100);
    const gstPct = Math.max(0, Number(line.gstRate) || 0);

    const gross = price * qty;
    const discountAmt = gross * (discPct / 100);
    const taxable = +(gross - discountAmt).toFixed(2);
    const tax = +(taxable * (gstPct / 100)).toFixed(2);

    line.taxableValue = taxable;
    line.taxAmount = tax;
    line.lineTotal = +(taxable + tax).toFixed(2);
  }

  onQtyChange(i: number, q: number): void {
    const line = this.cart[i];
    if (!line) return;
    line.quantity = Math.max(1, Math.floor(Number(q) || 1));
    this.recalc(line);
    this.cdr.markForCheck();
  }

  onDiscountChange(i: number, d: number): void {
    const line = this.cart[i];
    if (!line) return;
    line.discount = this.clamp(Number(d) || 0, 0, 100);
    this.recalc(line);
    this.cdr.markForCheck();
  }

  removeLine(i: number): void {
    this.cart.splice(i, 1);
    this.cart = [...this.cart];
    this.cdr.markForCheck();
  }

  trackByProductId(_: number, line: CartLine): number {
    return line.productID;
  }

  // ---------------- Totals ----------------
  get subTotal(): number { return this.round2(this.cart.reduce((s, l) => s + l.taxableValue, 0)); }
  get totalTax(): number { return this.round2(this.cart.reduce((s, l) => s + l.taxAmount, 0)); }
  get isInterState(): boolean {
    return (this.customerState || '').trim().toLowerCase() !==
           (this.companyState || '').trim().toLowerCase();
  }
  get cgst(): number { return this.isInterState ? 0 : this.round2(this.totalTax / 2); }
  get sgst(): number { return this.isInterState ? 0 : this.round2(this.totalTax - this.cgst); }
  get igst(): number { return this.isInterState ? this.totalTax : 0; }
  get grandTotal(): number { return this.round2(this.subTotal + this.totalTax); }
  get canSave(): boolean {
    return this.cart.length > 0 && !this.saving;
  }

  // ---------------- Customer autocomplete ----------------
  searchCustomers(): void {
    const q = (this.customerName || '').trim();
    if (!q) {
      this.suggestions = [];
      this.showSuggestions = false;
      this.cdr.markForCheck();
      return;
    }
    this.customerSearch$.next(q);
  }

  pickCustomer(c: Customer): void {
    this.customerName = c.fullName ?? '';
    this.customerGstin = c.gstin ?? '';
    this.customerMobile = c.mobile ?? '';
    if (c.state) this.customerState = c.state;
    this.suggestions = [];
    this.showSuggestions = false;
    this.cdr.markForCheck();
    this.focusBarcode();
  }

  hideSuggestionsLater(): void {
    if (this.suggestionHideTimer) clearTimeout(this.suggestionHideTimer);
    this.suggestionHideTimer = setTimeout(() => {
      this.showSuggestions = false;
      this.cdr.markForCheck();
    }, SUGGESTION_HIDE_DELAY_MS);
  }

  // ---------------- Save ----------------
  save(): void {
    this.error = '';
    if (this.cart.length === 0) {
      this.error = 'Cart is empty — scan an item first.';
      this.cdr.markForCheck();
      return;
    }
    if (this.saving) return;

    // Validate customer GSTIN format (loose) only if provided
    if (this.customerGstin && !/^[0-9A-Z]{15}$/i.test(this.customerGstin.trim())) {
      this.error = 'GSTIN must be 15 alphanumeric characters.';
      this.cdr.markForCheck();
      return;
    }

    this.saving = true;
    this.cdr.markForCheck();

    const body: Invoice = {
      customerName: this.customerName.trim() || undefined,
      customerGstin: this.customerGstin.trim().toUpperCase() || undefined,
      customerMobile: this.customerMobile.trim() || undefined,
      customerState: this.customerState,
      paymentMode: this.paymentMode,
      items: this.cart.map(l => ({
        productID: l.productID,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount
      }))
    };

    this.subs.add(
      this.http.post<Invoice>(`${environment.apiBaseUrl}/invoices`, body).pipe(
        timeout(HTTP_TIMEOUT_MS),
        finalize(() => { this.saving = false; this.cdr.markForCheck(); }),
        takeUntil(this.destroy$)
      ).subscribe({
        next: inv => {
          this.lastInvoice = inv;
          this.cdr.markForCheck();
        },
        error: (err: ApiError) => {
          this.error = this.userMessage(err, 'Failed to create invoice');
          this.cdr.markForCheck();
        }
      })
    );
  }

  newBill(): void {
    this.cart = [];
    this.customerName = '';
    this.customerGstin = '';
    this.customerMobile = '';
    this.customerState = this.companyState;
    this.paymentMode = 'CASH';
    this.lastInvoice = null;
    this.error = '';
    this.barcodeError = '';
    this.suggestions = [];
    this.showSuggestions = false;
    this.cdr.markForCheck();
    this.focusBarcode();
  }

  // ---------------- PDF ----------------
  printPdf(): void {
    this.fetchPdfBlob('print');
  }

  downloadPdf(): void {
    this.fetchPdfBlob('download');
  }

  private fetchPdfBlob(mode: 'print' | 'download'): void {
    const invId = this.lastInvoice?.invoiceID;
    if (!invId) return;
    if (mode === 'print' ? this.printingPdf : this.downloadingPdf) return;

    if (mode === 'print') this.printingPdf = true;
    else this.downloadingPdf = true;
    this.error = '';
    this.cdr.markForCheck();

    this.subs.add(
      this.http.get(
        `${environment.apiBaseUrl}/invoices/${invId}/pdf`,
        { responseType: 'blob' }
      ).pipe(
        timeout(HTTP_TIMEOUT_MS),
        finalize(() => {
          if (mode === 'print') this.printingPdf = false;
          else this.downloadingPdf = false;
          this.cdr.markForCheck();
        }),
        takeUntil(this.destroy$)
      ).subscribe({
        next: blob => {
          if (!blob || blob.size === 0) {
            this.error = 'Received empty PDF file.';
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
            a.download = `${this.safeFilename(this.lastInvoice?.invoiceNo) || 'invoice'}.pdf`;
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
      })
    );
  }

  // ---------------- Helpers ----------------
  private clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, Number(n) || 0));
  }

  private round2(n: number): number {
    return +Number(n || 0).toFixed(2);
  }

  private safeFilename(s: string | undefined | null): string {
    return (s ?? '').replace(/[^a-z0-9._-]/gi, '_');
  }

  trackByCustomerId(_: number, c: Customer): string | number {
    return c.customerID ?? c.mobile ?? c.fullName;
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
  // RxJS TimeoutError or other non-HTTP error
  if (err?.name === 'TimeoutError') return 'Request timed out. Please try again.';
  return (err?.message as string) || fallback;
}


  private handleSilentError(context: string, err: unknown): void {
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.error(`[Billing] ${context}`, err);
    }
  }
}