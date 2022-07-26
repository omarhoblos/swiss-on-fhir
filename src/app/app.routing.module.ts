import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HomeComponent } from '@component/home/home.component';
import { AuthGuard } from '@guards/auth.guard';
import { FhirdataComponent } from '@component/fhirdata/fhirdata.component';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'fhirdata', component: FhirdataComponent, canActivate: [AuthGuard] },
  { path: '**', redirectTo: ''}, 
]

@NgModule({
  declarations: [],
  imports: [CommonModule, RouterModule.forRoot(routes)],
  exports: [RouterModule]
})

export class AppRoutingModule { }
