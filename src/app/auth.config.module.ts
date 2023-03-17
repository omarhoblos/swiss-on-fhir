/*
 * // Copyright 2021 Omar Hoblos
 * //
 * // Licensed under the Apache License, Version 2.0 (the "License");
 * // you may not use this file except in compliance with the License.
 * // You may obtain a copy of the License at
 * //
 * //     http://www.apache.org/licenses/LICENSE-2.0
 * //
 * // Unless required by applicable law or agreed to in writing, software
 * // distributed under the License is distributed on an "AS IS" BASIS,
 * // WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * // See the License for the specific language governing permissions and
 * // limitations under the License.
 */

import { NgModule } from '@angular/core';
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
            aud: environment.audience,
            client_secret: environment.clientSecret
          },
          customParamsCodeRequest: {
            aud: environment.audience,
            audience: environment.audience,
            client_secret: environment.clientSecret
          },
          issValidationOff: environment.skipIssuerCheck
        }
      ]
    }),
  ],
  exports: [AuthModule],
})

export class AuthConfigModule {}
