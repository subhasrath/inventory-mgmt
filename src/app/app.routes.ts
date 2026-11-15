import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';
import { Signup } from './pages/signup/signup';
import { Login } from './pages/login/login';
import { ForgotPassword } from './pages/forgot-password/forgot-password';
import { Dashboard } from './pages/dashboard/dashboard';
import { Company } from './pages/company/company';
import { Purchase } from './pages/purchase/purchase';
import { Vendors } from './pages/vendors/vendors';
import { Items } from './pages/items/items';
import { Billing } from './pages/billing/billing';
import { SalesHistory } from './pages/sales-history/sales-history';
import { PurchaseHistory } from './pages/purchase-history/purchase-history';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'signup', component: Signup },
  { path: 'login', component: Login },
  { path: 'forgot-password', component: ForgotPassword },
  { path: 'dashboard', component: Dashboard, canActivate: [authGuard] },
  { path: 'my-company-settings', component: Company, canActivate: [authGuard] },
  { path: 'items', component: Items, canActivate: [authGuard] },
  { path: 'vendors', component: Vendors, canActivate: [authGuard] },
  { path: 'purchases', component: Purchase, canActivate: [authGuard] },
  { path: 'sales-history', component: SalesHistory, canActivate: [authGuard] },
  { path: 'purchase-history', component: PurchaseHistory, canActivate: [authGuard] },
  { path: 'billing', component: Billing, canActivate: [authGuard] },
  { path: '**', redirectTo: 'login' }
];