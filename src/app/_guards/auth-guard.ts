import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map, take } from 'rxjs';

export const isAuthenticated = () => {
  const oidcSecurityService = inject(OidcSecurityService);
  const router = inject(Router);

  return oidcSecurityService.isAuthenticated$.pipe(
    take(1),
    map(({ isAuthenticated }) => {
      // allow navigation if authenticated
      if (isAuthenticated) {
        return true;
      }

      // redirect if not authenticated
      return router.parseUrl('/unauthorized');
    })
  );
};