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

import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { AppComponent } from '@app/app.component';
import { FhirdataComponent } from '@component/fhirdata/fhirdata.component';
import { ErrorComponent } from '@component/error/error.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FooterComponent } from '@component/footer/footer.component';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { AppRoutingModule } from '@app/app-routing.module';
import { HomeComponent } from '@component/home/home.component';
import { AuthGuard } from '@guards/auth.guard';
import { AuthModule, LogLevel } from 'angular-auth-oidc-client';
import { environment } from '@env/environment';
import { NgxJsonViewerModule } from 'ngx-json-viewer';

@NgModule({
  declarations: [
    AppComponent,
    FhirdataComponent,
    ErrorComponent,
    FooterComponent,
    HomeComponent
  ],
  imports: [ 
    BrowserModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    FontAwesomeModule,
    AppRoutingModule,
    AuthModule.forRoot({
      config: {
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
        }
      },
    }),
    NgxJsonViewerModule
  ],
  providers: [AuthGuard],
  bootstrap: [AppComponent]
})

export class AppModule { }
