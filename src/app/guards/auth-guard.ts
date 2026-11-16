import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Auth } from '../services/auth';

export const authGuard: CanActivateFn = (_route, state): boolean | UrlTree => {
  const auth = inject(Auth);
  const router = inject(Router);

  if (auth.isLoggedIn()) return true;

  // Already heading to /login? Don't redirect to ourselves.
  if (state.url.startsWith('/login')) return true;

  // UrlTree is the idiomatic "redirect" return; no separate navigateByUrl call.
  return router.createUrlTree(['/login'], {
    queryParams: { redirect: state.url },
  });
};