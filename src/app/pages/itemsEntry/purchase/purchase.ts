import {
  ChangeDetectorRef, Component, OnDestroy, OnInit,
  inject, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { forkJoin, of, Subject } from 'rxjs';
import {
  catchError, finalize, takeUntil, timeout
} from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { Item, Vendor } from '../../../models/api.model';

type ApiError = HttpErrorResponse | { name: string; message?: string };

interface PurchaseLine {
  productID: number | null;
  batchNo: string;
  expiryDate: string;
  mrp: number;
  quantity: number;
  purchaseRate: number;
  gstRate: number;
  itemName?: string; // display only
}

interface PurchaseResponse {
  purchaseID?: number;
  purchaseNo?: string;
  grandTotal?: number;
}

const HTTP_TIMEOUT_MS = 20_000;
const GST_RATES = [0, 5, 12, 18, 28] as const;

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-purchase',
  styleUrl: './purchase.css',
  templateUrl: './purchase.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Purchase implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  readonly gstRates = GST_RATES;

  // lookups
  vendors: Vendor[] = [];
  items: Item[] = [];
  lookupsLoading = false;
  lookupsError = '';

  // header
  vendorID: number | null = null;
  vendorBillNo = '';
  purchaseDate = this.today();

  // lines
  lines: PurchaseLine[] = [];

  // state
  saving = false;
  message = '';
  success = false;
  lastPurchase: PurchaseResponse | null = null;

  // lifecycle
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loadLookups();
    this.lines = [this.emptyLine()];
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ---------------- Lookups ----------------
  private loadLookups(): void {
    if (this.lookupsLoading) return;
    this.lookupsLoading = true;
    this.lookupsError = '';
    this.cdr.markForCheck();

    forkJoin({
      vendors: this.http.get<Vendor[]>(`${environment.apiBaseUrl}/vendors`).pipe(
        timeout(HTTP_TIMEOUT_MS),
        catchError((err: ApiError) => {
          this.lookupsError = this.userMessage(err, 'Failed to load vendors');
          return of([] as Vendor[]);
        })
      ),
      items: this.http.get<Item[]>(`${environment.apiBaseUrl}/items`).pipe(
        timeout(HTTP_TIMEOUT_MS),
        catchError((err: ApiError) => {
          this.lookupsError = this.userMessage(err, 'Failed to load items');
          return of([] as Item[]);
        })
      ),
    }).pipe(
      finalize(() => {
        this.lookupsLoading = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe(({ vendors, items }) => {
      this.vendors = vendors;
      this.items = items;
      this.cdr.markForCheck();
    });
  }

  // ---------------- Lines ----------------
  private emptyLine(): PurchaseLine {
    return {
      productID: null,
      batchNo: '',
      expiryDate: '',
      mrp: 0,
      quantity: 0,
      purchaseRate: 0,
      gstRate: 18,
    };
  }

  addLine(): void {
    this.lines = [...this.lines, this.emptyLine()];
    this.cdr.markForCheck();
  }

  removeLine(i: number): void {
    if (this.lines.length <= 1) {
      // keep one empty line instead of leaving the table blank
      this.lines = [this.emptyLine()];
    } else {
      const next = [...this.lines];
      next.splice(i, 1);
      this.lines = next;
    }
    this.cdr.markForCheck();
  }

  onItemChange(i: number): void {
    const line = this.lines[i];
    if (!line) return;
    const item = this.items.find(it => it.productID === line.productID);
    if (item) {
      line.gstRate = Number(item.gstRate ?? 18);
      line.purchaseRate = Number(item.unitPrice ?? 0);
      line.itemName = item.itemName;
    } else {
      line.itemName = undefined;
    }
    this.cdr.markForCheck();
  }

  onLineQtyChange(i: number, v: number): void {
    const line = this.lines[i];
    if (!line) return;
    line.quantity = Math.max(0, Math.floor(Number(v) || 0));
    this.cdr.markForCheck();
  }

  onLineRateChange(i: number, v: number): void {
    const line = this.lines[i];
    if (!line) return;
    line.purchaseRate = Math.max(0, Number(v) || 0);
    this.cdr.markForCheck();
  }

  onLineMrpChange(i: number, v: number): void {
    const line = this.lines[i];
    if (!line) return;
    line.mrp = Math.max(0, Number(v) || 0);
    this.cdr.markForCheck();
  }

  // ---------------- Totals ----------------
  lineTaxable(l: PurchaseLine): number {
    return this.round2((Number(l.purchaseRate) || 0) * (Number(l.quantity) || 0));
  }
  lineTax(l: PurchaseLine): number {
    return this.round2(this.lineTaxable(l) * ((Number(l.gstRate) || 0) / 100));
  }
  lineTotal(l: PurchaseLine): number {
    return this.round2(this.lineTaxable(l) + this.lineTax(l));
  }

  get subTotal(): number {
    return this.round2(this.lines.reduce((s, l) => s + this.lineTaxable(l), 0));
  }
  get totalTax(): number {
    return this.round2(this.lines.reduce((s, l) => s + this.lineTax(l), 0));
  }
  get grandTotal(): number {
    return this.round2(this.subTotal + this.totalTax);
  }
  get validLineCount(): number {
    return this.lines.filter(l => this.isLineValid(l)).length;
  }
  get canSave(): boolean {
    return !!this.vendorID
      && this.validLineCount > 0
      && !this.saving
      && !this.lookupsLoading;
  }

  // ---------------- Save ----------------
  private isLineValid(l: PurchaseLine): boolean {
    return !!l.productID
      && !!l.batchNo?.trim()
      && !!l.expiryDate
      && Number(l.quantity) > 0
      && Number(l.purchaseRate) > 0;
  }

  save(): void {
    this.message = '';
    this.success = false;

    if (!this.vendorID) {
      this.fail('Select a vendor.');
      return;
    }
    if (!this.purchaseDate) {
      this.fail('Purchase date is required.');
      return;
    }
    // ensure the date isn't in the future
    if (this.purchaseDate > this.today()) {
      this.fail('Purchase date cannot be in the future.');
      return;
    }

    const clean = this.lines.filter(l => this.isLineValid(l));
    if (clean.length === 0) {
      this.fail('Add at least one valid line (item, batch, expiry, qty > 0, rate > 0).');
      return;
    }
    if (this.saving) return;

    // expandable: detect duplicate batch + product within this purchase
    const seen = new Set<string>();
    for (const l of clean) {
      const key = `${l.productID}::${l.batchNo.trim().toLowerCase()}`;
      if (seen.has(key)) {
        this.fail('Duplicate item + batch combination in the same purchase. Merge them into one line.');
        return;
      }
      seen.add(key);
    }

    this.saving = true;
    this.cdr.markForCheck();

    const body = {
      vendorID: this.vendorID,
      vendorBillNo: this.vendorBillNo.trim() || undefined,
      purchaseDate: this.purchaseDate,
      items: clean.map(l => ({
        productID: l.productID!,
        batchNo: l.batchNo.trim(),
        expiryDate: l.expiryDate,
        mrp: Math.max(0, Number(l.mrp) || 0),
        quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)),
        purchaseRate: Math.max(0, Number(l.purchaseRate) || 0),
        gstRate: GST_RATES.includes(l.gstRate as any) ? l.gstRate : 18,
      })),
    };

    this.http.post<PurchaseResponse>(
      `${environment.apiBaseUrl}/purchases`,
      body
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      finalize(() => {
        this.saving = false;
        this.cdr.markForCheck();
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: res => {
        this.success = true;
        this.message = `Purchase ${res.purchaseNo ?? ''} saved.`.trim();
        this.lastPurchase = res;
        this.resetHeaderAndLines();
      },
      error: (err: ApiError) => {
        this.success = false;
        this.message = this.userMessage(err, 'Save failed');
      },
    });
  }

  reset(): void {
    this.resetHeaderAndLines();
    this.message = '';
    this.success = false;
    this.lastPurchase = null;
    this.cdr.markForCheck();
  }

  private resetHeaderAndLines(): void {
    this.vendorID = null;
    this.vendorBillNo = '';
    this.purchaseDate = this.today();
    this.lines = [this.emptyLine()];
    this.cdr.markForCheck();
  }

  // ---------------- TrackBy ----------------
  trackByLine(_: number, l: PurchaseLine): number {
    // index-based is fine because lines are addressable by index; but productID+batch
    // is safer when we later reorder
    return _;
  }
  trackByVendor(_: number, v: Vendor): number | string {
    return v.vendorID ?? v.fullName ?? _;
  }
  trackByItem(_: number, i: Item): number | string {
    return i.productID ?? i.itemNumber ?? _;
  }

  // ---------------- Helpers ----------------
  private fail(msg: string): void {
    this.success = false;
    this.message = msg;
    this.cdr.markForCheck();
  }

  private today(): string {
    const d = new Date();
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
      if (err.status === 409) return 'A conflict occurred. Refresh and try again.';
      if (err.status === 422) return (err.error?.message as string) || 'Invalid data.';
      if (err.status >= 500) return 'Server error. Please try again shortly.';
      return (err.error?.message as string) || fallback;
    }
    if (err?.name === 'TimeoutError') return 'Request timed out. Please try again.';
    return (err?.message as string) || fallback;
  }
}