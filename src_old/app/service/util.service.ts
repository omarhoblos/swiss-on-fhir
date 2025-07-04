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
import jwtDecode, { JwtPayload } from 'jwt-decode';
import { errorObject } from '@interface/models'
import { OidcSecurityService } from 'angular-auth-oidc-client';

@Injectable({
  providedIn: 'root'
})
export class UtilService {

  constructor(
    private oidcSecurityService: OidcSecurityService
  ) { }

  returnObjectKeys(obj: Object) {
    return Object.keys(obj);
  }

  parseErrorMessage(obj: Object) {
    if (obj?.['error']?.['issue']) {
      return obj['error']['issue'][0];
    }

    if (obj?.['issue']) {
      return obj['issue'][0];
    }
  }

  copyToClipboard(value: string) {
    if (!navigator.clipboard) {
      const selBox = document.createElement('textarea');
      selBox.style.position = 'fixed';
      selBox.style.left = '0';
      selBox.style.top = '0';
      selBox.style.opacity = '0';
      selBox.value = value;
      document.body.appendChild(selBox);
      selBox.focus();
      selBox.select();
      document.execCommand('copy');
      document.body.removeChild(selBox);
    } else {
      navigator.clipboard.writeText(value)
        .then(() => {
          console.log("Copied the following token: " + value);
        })
        .catch(() => {
          console.log("There was an error copying this token.");
        });
    }
  }

  queryString(resource?: string, modifier?: string) {
    console.log(`Query sent to server: /${resource}${modifier}`);
    return `/${resource}` + modifier;
  }

  resetErrorObject(errorObject: errorObject) {
    errorObject.flag = false;
    errorObject.severity = '';
    errorObject.msg = '';
  }

  decodeToken(token: string) {
    return jwtDecode<JwtPayload>(token);
  }

  cleanQueryString(query: string) {
    let cleanedText = query.trim();

    if (cleanedText.charAt(0) !== '/') {
      cleanedText = `/${cleanedText}`
    }
    return cleanedText;
  }

  getDate(value: number) {
    return new Date(value * 1000);
  }

  returnTokenStatus() {
    let status: boolean;
    this.oidcSecurityService.isAuthenticated().subscribe(isAuthenticated => {
      status = isAuthenticated;
    })

    return status;
  }

  returnPatientId() {
    let patientId = '';
    this.oidcSecurityService.getAccessToken().subscribe(token => {
      if (token?.length > 0) {
        patientId = this.decodeToken(token)['patient']
      }
    })
    return patientId;
  }
}

