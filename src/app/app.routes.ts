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

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'signup', component: Signup },
  { path: 'login', component: Login },
  { path: 'forgot-password', component: ForgotPassword },
  { path: 'dashboard', component: Dashboard, canActivate: [authGuard] },
  { path: 'settings/company', component: Company, canActivate: [authGuard] },
  { path: 'items', component: Items, canActivate: [authGuard] },
  { path: 'vendors', component: Vendors, canActivate: [authGuard] },
  { path: 'purchases', component: Purchase, canActivate: [authGuard] },
  { path: 'billing', component: Billing, canActivate: [authGuard] },
  { path: '**', redirectTo: 'login' }
];