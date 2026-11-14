import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Item, Vendor } from '../../models/api.model';

interface PurchaseLine {
  productID: number | null;
  batchNo: string;
  expiryDate: string;
  mrp: number;
  quantity: number;
  purchaseRate: number;
  gstRate: number;
  // display
  itemName?: string;
}

interface PurchaseResponse {
  purchaseID?: number;
  purchaseNo?: string;
  grandTotal?: number;
}


@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-purchase',
  styleUrl: './purchase.css',
  templateUrl: './purchase.html',
})
export class Purchase implements OnInit{
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  vendors: Vendor[] = [];
  items: Item[] = [];

  vendorID: number | null = null;
  vendorBillNo = '';
  purchaseDate = new Date().toISOString().slice(0, 10);

  lines: PurchaseLine[] = [];
  saving = false;
  message = '';
  success = false;
  lastPurchase: PurchaseResponse | null = null;

  ngOnInit() {
    this.http.get<Vendor[]>(`${environment.apiBaseUrl}/vendors`).subscribe(v => {
      this.vendors = v; this.cdr.markForCheck();
    });
    this.http.get<Item[]>(`${environment.apiBaseUrl}/items`).subscribe(i => {
      this.items = i; this.cdr.markForCheck();
    });
    this.addLine();
  }

  addLine() {
    this.lines.push({
      productID: null, batchNo: '', expiryDate: '',
      mrp: 0, quantity: 0, purchaseRate: 0, gstRate: 18
    });
  }

  removeLine(i: number) { this.lines.splice(i, 1); }

  onItemChange(i: number) {
    const line = this.lines[i];
    const item = this.items.find(it => it.productID === line.productID);
    if (item) {
      line.gstRate = item.gstRate;
      line.purchaseRate = item.unitPrice;
      line.itemName = item.itemName;
    }
  }

  lineTotal(l: PurchaseLine): number {
    const base = (l.purchaseRate ?? 0) * (l.quantity ?? 0);
    return base + base * ((l.gstRate ?? 0) / 100);
  }

  subTotal(): number { return this.lines.reduce((s, l) => s + (l.purchaseRate ?? 0) * (l.quantity ?? 0), 0); }
  totalTax(): number { return this.lines.reduce((s, l) => s + ((l.purchaseRate ?? 0) * (l.quantity ?? 0) * ((l.gstRate ?? 0) / 100)), 0); }
  grandTotal(): number { return this.subTotal() + this.totalTax(); }

  save() {
    this.message = ''; this.success = false; this.lastPurchase = null;

    if (!this.vendorID) { this.message = 'Select a vendor'; return; }
    const clean = this.lines.filter(l =>
      l.productID && l.batchNo?.trim() && l.expiryDate && l.quantity > 0 && l.purchaseRate > 0);
    if (clean.length === 0) { this.message = 'Add at least one valid line'; return; }

    this.saving = true;

    const body = {
      vendorID: this.vendorID,
      vendorBillNo: this.vendorBillNo,
      purchaseDate: this.purchaseDate,
      items: clean.map(l => ({
        productID: l.productID,
        batchNo: l.batchNo.trim(),
        expiryDate: l.expiryDate,
        mrp: l.mrp,
        quantity: l.quantity,
        purchaseRate: l.purchaseRate,
        gstRate: l.gstRate
      }))
    };

    this.http.post<PurchaseResponse>(`${environment.apiBaseUrl}/purchases`, body).subscribe({
      next: res => {
        this.saving = false; this.success = true;
        this.message = 'Purchase saved.';
        this.lastPurchase = res;
        this.reset();
        this.lastPurchase = res;     // re-apply after reset
        this.cdr.markForCheck();
      },
      error: err => {
        this.saving = false; this.success = false;
        this.message = err.error?.message ?? 'Save failed';
        this.cdr.markForCheck();
      }
    });
  }

  reset() {
    this.vendorID = null;
    this.vendorBillNo = '';
    this.purchaseDate = new Date().toISOString().slice(0, 10);
    this.lines = [];
    this.addLine();
    this.message = '';
    this.success = false;
    this.cdr.markForCheck();
  }
}
