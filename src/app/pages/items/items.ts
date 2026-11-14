import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Item } from '../../models/api.model';
@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-items',
  styleUrl: './items.css',
  templateUrl: './items.html',
})
export class Items implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  items: Item[] = [];
  form: Item = this.emptyItem();
  editing = false;
  editingId: number | null = null;
  search = '';
  saving = false;
  message = '';
  success = false;

  ngOnInit() { this.load(); }

  private emptyItem(): Item {
    return {
      itemNumber: '', itemName: '', barcode: '', hsnCode: '',
      gstRate: 18, unit: 'PCS', unitPrice: 0, discount: 0,
      reorderLevel: 10, status: 'Active'
    };
  }

  load() {
    this.http.get<Item[]>(`${environment.apiBaseUrl}/items`).subscribe(list => {
      this.items = list;
      this.cdr.markForCheck();
    });
  }

  onSearch() {
    const q = this.search.trim();
    const url = q
      ? `${environment.apiBaseUrl}/items?q=${encodeURIComponent(q)}`
      : `${environment.apiBaseUrl}/items`;
    this.http.get<Item[]>(url).subscribe(list => {
      this.items = list;
      this.cdr.markForCheck();
    });
  }

  save() {
    this.message = '';
    this.success = false;

    if (!this.form.itemNumber?.trim()) { this.message = 'Item number is required'; return; }
    if (!this.form.itemName?.trim()) { this.message = 'Item name is required'; return; }
    const { status, ...fieldsToUpdate } = this.form;
    const body = this.editing ? fieldsToUpdate : this.form;
    this.saving = true;
    const req = this.editing && this.editingId
      ? this.http.put<Item>(`${environment.apiBaseUrl}/items/${this.editingId}`, body)
      : this.http.post<Item>(`${environment.apiBaseUrl}/items`, this.form);

    req.subscribe({
      next: () => {
        this.saving = false;
        this.success = true;
        this.message = this.editing ? 'Item updated.' : 'Item added.';
        this.form = this.emptyItem();
        this.editing = false;
        this.editingId = null;
        this.load();
        this.cdr.markForCheck();
      },
      error: err => {
        this.saving = false;
        this.success = false;
        this.message = err.error?.message ?? 'Save failed';
        this.cdr.markForCheck();
      }
    });
  }

  edit(i: Item) {
    this.form = { ...i };
    this.editing = true;
    this.editingId = i.productID!;
  }

  cancel() {
    this.form = this.emptyItem();
    this.editing = false;
    this.editingId = null;
    this.message = '';
  }

  deactivate(i: Item) {
    if (!confirm(`Deactivate ${i.itemName}?`)) return;
    this.http.delete(`${environment.apiBaseUrl}/items/${i.productID}`).subscribe(() => {
      this.load();
    });
  }

  activate(i: Item) {
  this.http.patch<Item>(
    `${environment.apiBaseUrl}/items/${i.productID}/status`,
    { status: 'Active' }
  ).subscribe({
    next: () => {
      this.message = `${i.itemName} activated.`;
      this.success = true;
      this.load();
    },
    error: err => {
      this.message = err.error?.message ?? 'Activate failed';
      this.success = false;
    }
  });
}
}
