import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Vendor } from '../../models/api.model';

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-vendors',
  styleUrl: './vendors.css',
  templateUrl: './vendors.html',
})
export class Vendors implements OnInit{
    private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  vendors: Vendor[] = [];
  form: Vendor = this.empty();
  editing = false;
  editingId: number | null = null;
  saving = false;
  message = '';
  success = false;

  ngOnInit() { this.load(); }

  private empty(): Vendor {
    return { fullName: '', gstin: '', mobile: '', phone2: '', email: '',
             address: '', city: '', district: '', state: '', pincode: '', status: 'Active' };
  }

  load() {
    this.http.get<Vendor[]>(`${environment.apiBaseUrl}/vendors`).subscribe(list => {
      this.vendors = list;
      this.cdr.markForCheck();
    });
  }

  save() {
    this.message = ''; this.success = false;
    if (!this.form.fullName?.trim()) { this.message = 'Name is required'; return; }
    if (!this.form.mobile?.trim()) { this.message = 'Mobile is required'; return; }
    if (!this.form.state?.trim()) { this.message = 'State is required'; return; }

    this.saving = true;
    const req = this.editing && this.editingId
      ? this.http.put<Vendor>(`${environment.apiBaseUrl}/vendors/${this.editingId}`, this.form)
      : this.http.post<Vendor>(`${environment.apiBaseUrl}/vendors`, this.form);

    req.subscribe({
      next: () => {
        this.saving = false; this.success = true;
        this.message = this.editing ? 'Vendor updated.' : 'Vendor added.';
        this.form = this.empty(); this.editing = false; this.editingId = null;
        this.load(); this.cdr.markForCheck();
      },
      error: err => {
        this.saving = false; this.success = false;
        this.message = err.error?.message ?? 'Save failed';
        this.cdr.markForCheck();
      }
    });
  }

  edit(v: Vendor) { this.form = { ...v }; this.editing = true; this.editingId = v.vendorID!; }
  cancel() { this.form = this.empty(); this.editing = false; this.editingId = null; this.message = ''; }
  deactivate(v: Vendor) {
    if (!confirm(`Deactivate ${v.fullName}?`)) return;
    this.http.delete(`${environment.apiBaseUrl}/vendors/${v.vendorID}`).subscribe(() => this.load());
  }
}
