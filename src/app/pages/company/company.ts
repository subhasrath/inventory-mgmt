import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { NewCompany } from '../../models/api.model';

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-company',
  styleUrl: './company.css',
  templateUrl: './company.html',
})
export class Company implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  company: NewCompany = {
    name: '', gstin: '', address: '', city: '', state: '',
    pincode: '', phone: '', email: '', invoicePrefix: 'INV', nextInvoiceNo: 1
  };

  saving = false;
  message = '';
  success = false;

  ngOnInit() {
    this.http.get<NewCompany | null>(`${environment.apiBaseUrl}/company`)
      .subscribe(existing => {
        if (existing) this.company = existing;
        this.cdr.markForCheck();
      });
  }

  save() {
    this.message = '';
    this.success = false;

    if (!this.company.name?.trim()) { this.message = 'Shop name is required'; return; }
    if (!this.company.gstin?.trim()) { this.message = 'GSTIN is required'; return; }
    if (!this.company.state?.trim()) { this.message = 'State is required'; return; }

    this.saving = true;

    this.http.post<NewCompany>(`${environment.apiBaseUrl}/company`, this.company)
      .subscribe({
        next: () => {
          this.saving = false;
          this.success = true;
          this.message = 'Company details saved.';
          this.cdr.markForCheck();
          setTimeout(() => this.router.navigateByUrl('/dashboard'), 1200);
        },
        error: err => {
          this.saving = false;
          this.success = false;
          this.message = err.error?.message ?? 'Save failed';
          this.cdr.markForCheck();
        }
      });
  }
}
