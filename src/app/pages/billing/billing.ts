import {
  Component, OnInit, AfterViewInit, OnDestroy,
  ElementRef, ViewChild, inject, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Item, Customer, Invoice } from '../../models/api.model';

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

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-billing',
  styleUrl: './billing.css',
  templateUrl: './billing.html',
})
export class Billing implements OnInit, AfterViewInit, OnDestroy{
  @ViewChild('barcodeInput') barcodeInput!: ElementRef<HTMLInputElement>;

  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  // scanner
  barcode = '';
  barcodeError = '';
  barcodeFocusTimer: any = null;

  // customer
  customerName = '';
  customerGstin = '';
  customerMobile = '';
  customerState = 'Maharashtra';
  suggestions: Customer[] = [];
  showSuggestions = false;

  // cart
  cart: CartLine[] = [];

  // meta
  paymentMode = 'CASH';

  // state
  saving = false;
  error = '';
  lastInvoice: Invoice | null = null;

  // company state for CGST/SGST vs IGST
  companyState = 'Maharashtra';

  ngOnInit() {
    // load company to know our state
    this.http.get<any>(`${environment.apiBaseUrl}/company`).subscribe(c => {
      if (c?.state) this.companyState = c.state;
      this.customerState = this.companyState;
      this.cdr.markForCheck();
    });
  }

  ngAfterViewInit() {
    this.focusBarcode();
    // auto-refocus the barcode field every 1.5s unless user is typing somewhere else
    this.barcodeFocusTimer = setInterval(() => this.refocusIfIdle(), 1500);
  }

  ngOnDestroy() {
    if (this.barcodeFocusTimer) clearInterval(this.barcodeFocusTimer);
  }

  /** Always keep focus on scanner input unless user is actively in another field. */
  private refocusIfIdle() {
    const el = document.activeElement as HTMLElement | null;
    if (!el) { this.focusBarcode(); return; }
    const tag = el.tagName;
    const type = (el as HTMLInputElement).type;
    const isBarcodeField = el === this.barcodeInput?.nativeElement;
    const isOtherInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON';
    if (!isBarcodeField && !isOtherInput) this.focusBarcode();
    if (isOtherInput && type === 'text' && !isBarcodeField) return; // user is on another text field
  }

  focusBarcode() {
    setTimeout(() => this.barcodeInput?.nativeElement.focus(), 50);
  }

  // ---------------- Scanner ----------------
  onBarcodeEnter() {
    const code = (this.barcode || '').trim();
    this.barcode = '';
    this.barcodeError = '';
    if (!code) return;

    this.http.get<Item>(`${environment.apiBaseUrl}/items/barcode/${encodeURIComponent(code)}`)
      .subscribe({
        next: item => this.addToCart(item),
        error: () => {
          this.barcodeError = `No item for barcode "${code}"`;
          this.cdr.markForCheck();
          this.focusBarcode();
        }
      });
  }

  // ---------------- Cart ----------------
  addToCart(item: Item) {
    const existing = this.cart.find(l => l.productID === item.productID);
    if (existing) {
      existing.quantity += 1;
      this.recalc(existing);
    } else {
      const line: CartLine = {
        productID: item.productID!,
        itemName: item.itemName,
        hsnCode: item.hsnCode,
        quantity: 1,
        unitPrice: Number(item.unitPrice ?? 0),
        discount: Number(item.discount ?? 0),
        gstRate: Number(item.gstRate ?? 0),
        taxableValue: 0,
        taxAmount: 0,
        lineTotal: 0
      };
      this.recalc(line);
      this.cart.push(line);
    }
    this.cdr.markForCheck();
    this.focusBarcode();
  }

  recalc(line: CartLine) {
    const qty = Math.max(1, Number(line.quantity) || 0);
    line.quantity = qty;
    const gross = line.unitPrice * qty;
    const discountAmt = gross * ((line.discount || 0) / 100);
    const taxable = +(gross - discountAmt).toFixed(2);
    const tax = +(taxable * ((line.gstRate || 0) / 100)).toFixed(2);
    line.taxableValue = taxable;
    line.taxAmount = tax;
    line.lineTotal = +(taxable + tax).toFixed(2);
  }

  onQtyChange(i: number, q: number) {
    this.cart[i].quantity = Number(q);
    this.recalc(this.cart[i]);
    this.cdr.markForCheck();
  }

  removeLine(i: number) {
    this.cart.splice(i, 1);
    this.cdr.markForCheck();
  }

  // ---------------- Totals (matches backend GST logic) ----------------
  get subTotal() { return +this.cart.reduce((s, l) => s + l.taxableValue, 0).toFixed(2); }
  get totalTax() { return +this.cart.reduce((s, l) => s + l.taxAmount, 0).toFixed(2); }
  get isInterState() {
    return (this.customerState || '').trim().toLowerCase() !==
           (this.companyState || '').trim().toLowerCase();
  }
  get cgst() { return this.isInterState ? 0 : +(this.totalTax / 2).toFixed(2); }
  get sgst() { return this.isInterState ? 0 : +(this.totalTax - this.cgst).toFixed(2); }
  get igst() { return this.isInterState ? this.totalTax : 0; }
  get grandTotal() { return +(this.subTotal + this.totalTax).toFixed(2); }

  // ---------------- Customer autocomplete ----------------
  searchCustomers() {
    const q = (this.customerName || '').trim();
    if (q.length < 1) { this.suggestions = []; this.showSuggestions = false; return; }
    this.http.get<Customer[]>(`${environment.apiBaseUrl}/customers/walkin-search?q=${encodeURIComponent(q)}`)
      .subscribe(list => {
        this.suggestions = list;
        this.showSuggestions = list.length > 0;
        this.cdr.markForCheck();
      });
  }

  pickCustomer(c: Customer) {
    this.customerName = c.fullName;
    this.customerGstin = c.gstin ?? '';
    this.customerMobile = c.mobile ?? '';
    if (c.state) this.customerState = c.state;
    this.suggestions = [];
    this.showSuggestions = false;
    this.cdr.markForCheck();
    this.focusBarcode();
  }

  hideSuggestionsLater() {
    setTimeout(() => { this.showSuggestions = false; this.cdr.markForCheck(); }, 150);
  }

  // ---------------- Save ----------------
  save() {
    this.error = '';
    if (this.cart.length === 0) { this.error = 'Cart is empty — scan an item first.'; return; }

    this.saving = true;

    const body: Invoice = {
      customerName: this.customerName || undefined,
      customerGstin: this.customerGstin || undefined,
      customerMobile: this.customerMobile || undefined,
      customerState: this.customerState,
      paymentMode: this.paymentMode,
      items: this.cart.map(l => ({
        productID: l.productID,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount
      }))
    };

    this.http.post<Invoice>(`${environment.apiBaseUrl}/invoices`, body).subscribe({
      next: inv => {
        this.saving = false;
        this.lastInvoice = inv;
        this.cdr.markForCheck();
      },
      error: err => {
        this.saving = false;
        this.error = err.error?.message ?? 'Failed to create invoice';
        this.cdr.markForCheck();
      }
    });
  }

  newBill() {
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

printPdf() {
  if (!this.lastInvoice?.invoiceID) return;

  this.http.get(
    `${environment.apiBaseUrl}/invoices/${this.lastInvoice.invoiceID}/pdf`,
    { responseType: 'blob' }
  ).subscribe({
    next: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Clean up after the tab loads
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    error: (err) => {
      this.error = err.error?.message ?? 'Failed to load PDF';
    }
  });
}

downloadPdf() {
  if (!this.lastInvoice?.invoiceID) return;

  this.http.get(
    `${environment.apiBaseUrl}/invoices/${this.lastInvoice.invoiceID}/pdf`,
    { responseType: 'blob' }
  ).subscribe({
    next: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.lastInvoice!.invoiceNo || 'invoice'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    error: (err) => {
      this.error = err.error?.message ?? 'Failed to download PDF';
    }
  });
}
}
