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

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http'
import { environment } from '@env/environment'
import { OidcSecurityService } from 'angular-auth-oidc-client';

@Injectable({
  providedIn: 'root'
})

export class HttpService {

  constructor(
    private http: HttpClient,
    private oidcSecurityService: OidcSecurityService
  ) { }

  getFhirQueries(query?: string, headers?: HttpHeaders) {
    const theQuery = ['http', 'https'].some(word => query.startsWith(word)) || query?.match(/^\d/) ? query : `${environment.fhirEndpointUri}${query}`;
    if (headers) {
      return this.http.get(`${theQuery}`, { headers: headers });
    } else {
      return this.http.get(`${theQuery}`);
    }
  }

  logout() {
    this.oidcSecurityService.logoffAndRevokeTokens()
      .subscribe((result) => {
        console.log(result)
        sessionStorage.clear();
      });
  }

  getHeaders(): HttpHeaders {
    let headers;
    this.oidcSecurityService.getAccessToken().subscribe(token => {
      headers = new HttpHeaders({
        'Authorization': `Bearer ${token}`,
      });
    })

    return headers;
  }
}
