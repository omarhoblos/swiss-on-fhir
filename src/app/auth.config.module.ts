import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthModule, LogLevel } from 'angular-auth-oidc-client';
import { environment } from '@env/environment';

@NgModule({
  imports: [
    AuthModule.forRoot({
      config: [
        {
          authority: environment.issuer,
          redirectUrl: window.location.origin,
          postLogoutRedirectUri: window.location.origin,
          clientId: environment.clientId,
          scope: environment.scopes,
          responseType: 'code',
          silentRenew: true,
          useRefreshToken: true,
          logLevel: LogLevel.Debug,
          customParamsAuthRequest: {
            client_secret: environment.clientSecret
          },
          customParamsCodeRequest: {
            client_secret: environment.clientSecret
          },
          issValidationOff: environment.skipIssuerCheck
        }
      ],
    }),
  ],
  exports: [AuthModule],
})
export class AuthConfigModule {}