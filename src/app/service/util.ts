import { Injectable } from '@angular/core';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { errorObject } from '@interface/model'
import { OidcSecurityService } from 'angular-auth-oidc-client';

@Injectable({
  providedIn: 'root'
})

export class Util {

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
