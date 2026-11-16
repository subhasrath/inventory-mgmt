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
import { Item } from '../../../models/api.model';

type ApiError = HttpErrorResponse | { name: string; message?: string };

const HTTP_TIMEOUT_MS = 15_000;
const SEARCH_DEBOUNCE_MS = 250;

interface ItemForm {
  itemNumber: string;
  itemName: string;
  barcode: string;
  hsnCode: string;
  gstRate: number;
  unit: string;
  unitPrice: number;
  discount: number;
  reorderLevel: number;
}

const GST_RATES = [0, 5, 12, 18, 28] as const;
const UNITS = ['PCS', 'STRIP', 'BOX', 'KG', 'GM', 'LTR', 'ML'] as const;

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-items',
  styleUrl: './items.css',
  templateUrl: './items.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Items implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  readonly gstRates = GST_RATES;
  readonly units = UNITS;

  // list
  items: Item[] = [];
  listLoading = false;
  listError = '';

  // search
  search = '';
  private search$ = new Subject<string>();

  // form
  form: ItemForm = this.emptyForm();
  editing = false;
  editingId: number | null = null;
  saving = false;
  message = '';
  success = false;

  // deactivate confirmation
  pendingDeactivate: Item | null = null;
  deactivating = false;

  // lifecycle
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    // search pipeline
    this.search$.pipe(
      debounceTime(SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap(q => {
        this.listLoading = true;
        this.listError = '';
        this.cdr.markForCheck();
        return this.fetchItems(q).pipe(
          finalize(() => {
            this.listLoading = false;
            this.cdr.markForCheck();
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(list => {
      this.items = list;
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

  private fetchItems(q: string) {
    let params = new HttpParams();
    if (q) params = params.set('q', q);
    return this.http.get<Item[]>(
      `${environment.apiBaseUrl}/items`,
      { params }
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      catchError((err: ApiError) => {
        this.listError = this.userMessage(err, 'Failed to load items');
        return of([] as Item[]);
      })
    );
  }

  // ---------------- Form ----------------
  private emptyForm(): ItemForm {
    return {
      itemNumber: '',
      itemName: '',
      barcode: '',
      hsnCode: '',
      gstRate: 18,
      unit: 'PCS',
      unitPrice: 0,
      discount: 0,
      reorderLevel: 10,
    };
  }

  save(): void {
    this.message = '';
    this.success = false;

    const err = this.validate();
    if (err) {
      this.success = false;
      this.message = err;
      this.cdr.markForCheck();
      return;
    }
    if (this.saving) return;

    this.saving = true;
    this.cdr.markForCheck();

    const body: Partial<Item> = {
      itemNumber: this.form.itemNumber.trim(),
      itemName: this.form.itemName.trim(),
      barcode: this.form.barcode.trim() || undefined,
      hsnCode: this.form.hsnCode.trim() || undefined,
      gstRate: this.clamp(this.form.gstRate, 0, 28),
      unit: this.form.unit,
      unitPrice: Math.max(0, Number(this.form.unitPrice) || 0),
      discount: this.clamp(this.form.discount, 0, 100),
      reorderLevel: Math.max(0, Math.floor(Number(this.form.reorderLevel) || 0)),
    };

    const req = this.editing && this.editingId
      ? this.http.put<Item>(`${environment.apiBaseUrl}/items/${this.editingId}`, body)
      : this.http.post<Item>(`${environment.apiBaseUrl}/items`, body);

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
        this.message = this.editing ? 'Item updated.' : 'Item added.';
        this.resetForm();
        this.load();
      },
      error: (err2: ApiError) => {
        this.success = false;
        this.message = this.userMessage(err2, 'Save failed');
      },
    });
  }

  edit(i: Item): void {
    if (!i.productID) return;
    this.form = {
      itemNumber: i.itemNumber ?? '',
      itemName: i.itemName ?? '',
      barcode: i.barcode ?? '',
      hsnCode: i.hsnCode ?? '',
      gstRate: Number(i.gstRate ?? 18),
      unit: i.unit ?? 'PCS',
      unitPrice: Number(i.unitPrice ?? 0),
      discount: Number(i.discount ?? 0),
      reorderLevel: Number(i.reorderLevel ?? 10),
    };
    this.editing = true;
    this.editingId = i.productID;
    this.message = '';
    this.success = false;
    this.cdr.markForCheck();
  }

  cancel(): void {
    this.resetForm();
  }

  private resetForm(): void {
    this.form = this.emptyForm();
    this.editing = false;
    this.editingId = null;
    this.message = '';
    this.success = false;
    this.cdr.markForCheck();
  }

  private validate(): string | null {
    const f = this.form;
    if (!f.itemNumber?.trim()) return 'Item number is required.';
    if (!f.itemName?.trim()) return 'Item name is required.';
    if (f.itemNumber.trim().length > 40) return 'Item number must be ≤ 40 characters.';
    if (f.itemName.trim().length > 200) return 'Item name must be ≤ 200 characters.';
    if (f.hsnCode && !/^\d{4,8}$/.test(f.hsnCode.trim())) {
      return 'HSN code must be 4–8 digits.';
    }
    if (f.barcode && f.barcode.trim().length > 64) {
      return 'Barcode must be ≤ 64 characters.';
    }
    if (!GST_RATES.includes(f.gstRate as any)) return 'Invalid GST rate.';
    if (!UNITS.includes(f.unit as any)) return 'Invalid unit.';
    if (!Number.isFinite(f.unitPrice) || f.unitPrice < 0) return 'Unit price must be ≥ 0.';
    if (!Number.isFinite(f.discount) || f.discount < 0 || f.discount > 100) {
      return 'Discount must be between 0 and 100.';
    }
    if (!Number.isFinite(f.reorderLevel) || f.reorderLevel < 0) {
      return 'Reorder level must be ≥ 0.';
    }
    return null;
  }

  // ---------------- Status ----------------
  requestDeactivate(i: Item): void {
    this.pendingDeactivate = i;
    this.cdr.markForCheck();
  }

  cancelDeactivate(): void {
    this.pendingDeactivate = null;
    this.cdr.markForCheck();
  }

  confirmDeactivate(): void {
    const i = this.pendingDeactivate;
    if (!i?.productID || this.deactivating) return;

    this.deactivating = true;
    this.cdr.markForCheck();

    this.http.delete(`${environment.apiBaseUrl}/items/${i.productID}`).pipe(
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
        this.message = `${i.itemName} deactivated.`;
        this.load();
      },
      error: (err: ApiError) => {
        this.success = false;
        this.message = this.userMessage(err, 'Deactivate failed');
      },
    });
  }

  activate(i: Item): void {
    if (!i.productID) return;

    this.http.patch<Item>(
      `${environment.apiBaseUrl}/items/${i.productID}/status`,
      { status: 'Active' }
    ).pipe(
      timeout(HTTP_TIMEOUT_MS),
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.success = true;
        this.message = `${i.itemName} activated.`;
        this.load();
        this.cdr.markForCheck();
      },
      error: (err: ApiError) => {
        this.success = false;
        this.message = this.userMessage(err, 'Activate failed');
        this.cdr.markForCheck();
      },
    });
  }

  // ---------------- TrackBy ----------------
  trackByItem(_: number, i: Item): number | string {
    return i.productID ?? i.itemNumber ?? _;
  }

  // ---------------- Helpers ----------------
  private clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, Number(n) || 0));
  }

  private userMessage(err: ApiError, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Network error — check your connection.';
      if (err.status === 401) return 'Session expired. Please sign in again.';
      if (err.status === 403) return 'You do not have permission for this action.';
      if (err.status === 408) return 'Request timed out. Please try again.';
      if (err.status === 409) return 'An item with that number or barcode already exists.';
      if (err.status === 422) return (err.error?.message as string) || 'Invalid data.';
      if (err.status >= 500) return 'Server error. Please try again shortly.';
      return (err.error?.message as string) || fallback;
    }
    if (err?.name === 'TimeoutError') return 'Request timed out. Please try again.';
    return (err?.message as string) || fallback;
  }
}