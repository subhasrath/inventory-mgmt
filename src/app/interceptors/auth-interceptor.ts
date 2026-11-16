import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Auth } from '../services/auth';

/** True only for exact auth endpoints — avoids matching e.g. "/users/loginfoo". */
function isAuthEndpoint(url: string): boolean {
  const path = url.split('?')[0];
  return /\/users\/(login|signup)$/.test(path);
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const router = inject(Router);

  const authFlow = isAuthEndpoint(req.url);
  const token = auth.getToken();
  const usedToken = (!authFlow && token) ? token : null;

  const request = usedToken
    ? req.clone({ setHeaders: { Authorization: `Bearer ${usedToken}` } })
    : req;

  return next(request).pipe(
    catchError((err: HttpErrorResponse) => {
      const expired = err.status === 401 || err.status === 403;

      // Only log the user out if the token we *just* sent is still the current one.
      // This prevents a slow-failing request from killing a fresh session
      // created in another tab or after a re-login.
      if (expired && !authFlow && usedToken && usedToken === auth.getToken()) {
        auth.logout();
        // Guard will bounce the next navigation; also do it now for the current route.
        const current = router.url;
        if (!current.startsWith('/login')) {
          router.navigateByUrl('/login').catch(() => { /* router surfaces nav errors */ });
        }
      }
      return throwError(() => err);
    })
  );
};