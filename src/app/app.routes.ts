import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';
import { Signup } from './pages/user/signup/signup';
import { Login } from './pages/user/login/login';
import { ForgotPassword } from './pages/user/forgot-password/forgot-password';
import { Dashboard } from './pages/dashboard/dashboard';
import { Company } from './pages/user/company/company';
import { Purchase } from './pages/itemsEntry/purchase/purchase';
import { Vendors } from './pages/itemsEntry/vendors/vendors';
import { Items } from './pages/itemsEntry/items/items';
import { Billing } from './pages/billing/billing';
import { SalesHistory } from './pages/historyCheck/sales-history/sales-history';
import { PurchaseHistory } from './pages/historyCheck/purchase-history/purchase-history';

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