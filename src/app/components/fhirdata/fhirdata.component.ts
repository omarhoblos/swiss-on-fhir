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
import { faCog, faCheck, faPlusSquare, faTimesCircle, faCheckSquare } from '@fortawesome/free-solid-svg-icons';

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
  faPlusSquare = faPlusSquare;
  faTimesCircle = faTimesCircle;
  faCheckSquare= faCheckSquare;
  
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
      persistAuthorizationHeader: new FormControl()
    });

    this.checkIfPersistHeaderSelectionWasMadePrevious();
  }

  queryHeaders() {
    return this.queryFormGroup.get('queryHeaders') as FormArray;
  }

  newHeader(): FormGroup {
    return this.fb.group({
      key: '',
      value: ''
    })
  }

  addHeader() {
    this.queryHeaders().push(this.newHeader());
  }

  removeHeader(index: number) {
    this.queryHeaders().removeAt(index);
  }

  persistHeaderSelectionInLocalStorage(event: any) {
    if (event.target.checked) {
      localStorage.setItem('persistAuthorizationHeader', 'checked');
    } else {
      localStorage.removeItem('persistAuthorizationHeader');
    }
  }

  checkIfPersistHeaderSelectionWasMadePrevious() {
    if (localStorage?.getItem('persistAuthorizationHeader')) {
      this.queryFormGroup.get('persistAuthorizationHeader').setValue(true);
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
