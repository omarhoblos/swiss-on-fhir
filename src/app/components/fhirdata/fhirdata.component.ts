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

import { Component, OnInit } from '@angular/core';
import { HttpService, } from '@service/http.service'
import { HttpHeaders } from '@angular/common/http'
import { OAuthService } from 'angular-oauth2-oidc'
import { UtilService } from '@service/util.service'
import { errorObject } from '@interface/models'
import { environment } from '@env/environment'
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { faCog, faCheck, faPlusCircle, faTimesCircle, faCheckSquare, faMinusCircle } from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'app-fhirdata',
  templateUrl: './fhirdata.component.html',
  styleUrls: ['./fhirdata.component.css']
})
export class FhirdataComponent implements OnInit {

  errorObject: errorObject = {
    flag: false,
    severity: '',
    msg: ''
  }

  faCog = faCog;
  faCheck = faCheck;
  faPlusCircle = faPlusCircle;
  faTimesCircle = faTimesCircle;
  faCheckSquare = faCheckSquare;
  faMinusCircle = faMinusCircle;

  showLoadingBar = false;
  patientId: string;
  searchTypeHeader: string
  customQuery = '';
  bundleFound: {};
  queryFormGroup: FormGroup;

  constructor(
    private httpService: HttpService,
    private oauthService: OAuthService,
    private fb: FormBuilder,
    private utilService: UtilService
  ) { }

  ngOnInit() {
    this.queryFormGroup = this.fb.group({
      query: new FormControl(`${environment.fhirEndpointUri}/`, Validators.required),
      queryHeaders: this.fb.array([]),
      persistAuthorizationHeader: new FormControl(),
      persistHeaders: new FormControl()
    });

    this.checkIfPersistHeaderSelectionWasMadePrevious();
  }

  queryHeaders() {
    return this.queryFormGroup.get('queryHeaders') as FormArray;
  }

  newHeader(value?: object): FormGroup {
    return this.fb.group({
      key: value?.['key'] ? value['key'] : ''  ,
      value: value?.['value'] ? value['value'] : ''  
    })
  }

  addHeader(value?: object) {
    this.queryHeaders().push(this.newHeader(value));
  }

  removeHeader(index: number) {
    this.queryHeaders().removeAt(index);
  }

  persistCurrentHeadersInLocalStorage(event: any, selection: string) {
    if (event.target.checked) {
      if (selection.trim() === 'auth') {
        localStorage.setItem('persistAuthorizationHeader', 'checked');
      }
      if (selection.trim() === 'everything') {
        localStorage.setItem('persistCurrentHeaders', JSON.stringify(this.queryFormGroup.get('queryHeaders').value));
      }
    } else {
      if (selection.trim() === 'auth') {
        localStorage.removeItem('persistAuthorizationHeader');
      }
      if (selection.trim() === 'everything') {
        localStorage.removeItem('persistCurrentHeaders');
      }
    }
  }

  checkIfPersistHeaderSelectionWasMadePrevious() {
    if (localStorage?.getItem('persistAuthorizationHeader')) {
      this.queryFormGroup.get('persistAuthorizationHeader').setValue(true);
    }
    if (localStorage?.getItem('persistCurrentHeaders')) {
      this.queryFormGroup.get('persistHeaders').setValue(true);

      const storedHeaders = JSON.parse(localStorage.getItem('persistCurrentHeaders'));
      console.log(storedHeaders);
      for (const headerFound of storedHeaders) {
        console.log(headerFound['key'], headerFound['value']);
        this.addHeader(headerFound);
      }
      
    } 
  }


  onSubmit() {
    const tempHeaderObject = {};
    for (let headerFound of this.queryFormGroup.get('queryHeaders').value) {
      if (headerFound?.key?.length > 0 && headerFound?.value?.length > 0) {
        tempHeaderObject[headerFound.key] = headerFound.value;
      }
    }

    if (this.queryFormGroup.get('persistAuthorizationHeader').value) {
      tempHeaderObject['Authorization'] = `Bearer ${this.oauthService.getAccessToken()}`
    }

    if (Object.keys(tempHeaderObject).length > 0 && this.queryFormGroup.get('query')?.value?.length > 0) {
      const headers = new HttpHeaders(tempHeaderObject);
      this.apiCallFunction(this.queryFormGroup.get('query').value.trim(), headers)
    } else {
      this.apiCallFunction(this.queryFormGroup.get('query').value.trim())
    }

    this.searchTypeHeader = `${this.queryFormGroup.get('query').value.trim()}`;
  }

  fetchPatientDataInSession(typeOfQueryFlag?: string) {
    let query = this.utilService.queryString('Patient', `?_id=${this.returnPatientId()}&_revinclude:iterate=ExplanationOfBenefit:patient`);

    if (typeOfQueryFlag === "everything") {
      query = this.utilService.queryString('Patient', `/${this.returnPatientId()}/$everything`);
    }

    this.searchTypeHeader = `${environment.fhirEndpointUri}${query}`;
    this.apiCallFunction(query, this.headers());
  }

  private apiCallFunction(query: string, headers?: HttpHeaders) {
    if (this.oauthService.hasValidAccessToken()) {
      this.showLoadingBar = true;
      this.utilService.resetErrorObject(this.errorObject);
      this.httpService.getFhirQueries(query, headers).subscribe(
        recordsFound => {
          const result = this.setupDataInView(recordsFound);
          if (result === 'dataFound') {
            this.bundleFound = recordsFound;
          }
          setTimeout(() => {
            this.showLoadingBar = false;
          }, 500);
        },
        error => {
          this.setupErrorView(error);
        }
      );
    } else {
      this.httpService.logout();
    }
  }

  private setupErrorView(error: any) {
    if (error) {
      setTimeout(() => {
        this.showLoadingBar = false;
      }, 500);
      const issue = this.utilService.parseErrorMessage(error);
      this.errorObject.flag = true;
      this.errorObject.severity = issue?.['severity'] ? issue?.['severity'] : 'error';
      this.errorObject.msg = issue?.['diagnostics'] ? issue?.['diagnostics'] : error?.['message'];
      console.log(this.errorObject);
    }
  }

  private setupDataInView(recordsFound: Object) {
    let verdictOfData = 'noDataFound'
    if (recordsFound?.['entry'] || recordsFound?.['resourceType'] !== 'OperationOutcome') {
      this.bundleFound = recordsFound;
      console.log(`Bundle Found: + ${recordsFound}`);
      verdictOfData = "dataFound"
    } else {
      this.errorObject.flag = true;
      this.errorObject.severity = 'warning';
      this.errorObject.msg = 'Resource Not Found';
      verdictOfData = "noDataFound"
    }
    setTimeout(() => {
      this.showLoadingBar = false;
    }, 500);
    return verdictOfData;
  }

  returnPatientId() {
    return this.utilService.decodeToken(this.oauthService.getAccessToken())['patient'];
  }

  headers(): HttpHeaders {
    const headers = new HttpHeaders({
      'Content-Type': 'application/fhir+json',
      Authorization: 'Bearer ' + this.oauthService.getAccessToken()
    });
    return headers;
  }

}
