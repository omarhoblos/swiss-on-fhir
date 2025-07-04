import { Routes } from '@angular/router';
import { Home } from '@component/home/home';
import { Fhirdata } from '@component/fhirdata/fhirdata';
import { isAuthenticated } from '@guards/auth-guard'

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'fhirdata', component: Fhirdata, canActivate: [isAuthenticated] },
  { path: '**', redirectTo: ''}
]


