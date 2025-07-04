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

import { Component, OnInit, AfterViewInit } from '@angular/core';
import { UtilService } from '@app/service/util.service';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import * as dayjs from 'dayjs'

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit, AfterViewInit {

  tokenObjectForDisplay = {
    accessToken: 'No Token Found',
    idToken: 'No Token Found',
    claims: {},
    decodedAccessToken: null,
    expirationDate: null
  };

  protected CURRENT_DATE = dayjs();
  expirationMinutes: number;

  constructor(
    private utilService: UtilService,
    private oidcSecurityService: OidcSecurityService
  ) { }

  ngOnInit(): void {
    this.oidcSecurityService.checkAuth().subscribe(({ isAuthenticated, userData, accessToken, idToken, errorMessage }) => {
      this.checkIfTokenIsInSession(accessToken, idToken)
      if (errorMessage) {
        console.log(errorMessage)
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.expirationMinutes >= 0) {
      this.checkExpiration()
    }
  }

  returnTokenStatus() {
    return this.utilService.returnTokenStatus();
  }

  private checkIfTokenIsInSession(accessToken: string, idToken: string) {
    if (accessToken?.length > 0 || idToken?.length > 0) {

      const staticAccessToken = this.utilService.decodeToken(accessToken);
      const staticIdToken = this.utilService.decodeToken(idToken)
      const expirationDate = dayjs.unix(staticAccessToken['exp']);

      this.tokenObjectForDisplay['decodedAccessTokenKeys'] = this.utilService.returnObjectKeys(staticAccessToken);
      this.tokenObjectForDisplay['decodedAccessToken'] = staticAccessToken;
      this.tokenObjectForDisplay['accessToken'] = accessToken;
      this.tokenObjectForDisplay['claimsKeys'] = this.utilService.returnObjectKeys(staticIdToken);
      this.tokenObjectForDisplay['claims'] = staticIdToken;
      this.tokenObjectForDisplay['idToken'] = idToken;
      this.tokenObjectForDisplay['expirationDate'] = expirationDate;
      this.tokenObjectForDisplay['expirationDateForDisplay'] = expirationDate['$d'];
    }
    this.checkExpiration()
  }

  checkExpiration() {
    if (this.tokenObjectForDisplay?.['expirationDate']) {
      this.expirationMinutes = this.tokenObjectForDisplay['expirationDate']?.diff(this.CURRENT_DATE, 'minute');
      console.log(`Time left for token: ${this.expirationMinutes}`);
    }
  }

  login() {
    this.oidcSecurityService.authorize();
  }

  copyToClipboard(value: string) {
    this.utilService.copyToClipboard(value);
  }
}
