import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http'
import { environment } from '@env/environment'
import { OidcSecurityService } from 'angular-auth-oidc-client';

@Injectable({
  providedIn: 'root'
})
export class Http {

  constructor(
    private http: HttpClient,
    private oidcSecurityService: OidcSecurityService
  ) { }

    getFhirQueries(query?: string, headers?: HttpHeaders) {
    const theQuery = ['http', 'https'].some(word => query?.startsWith(word)) || query?.match(/^\d/) ? query : `${environment.fhirEndpointUri}${query}`;
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
    let headers: any;
    this.oidcSecurityService.getAccessToken().subscribe(token => {
      headers = new HttpHeaders({
        'Authorization': `Bearer ${token}`,
      });
    })

    return headers;

  }
}
