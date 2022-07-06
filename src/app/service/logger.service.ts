import { Injectable } from '@angular/core';
import { PublicEventsService, EventTypes } from 'angular-auth-oidc-client';
import { filter } from 'rxjs';
import { OidcSecurityService } from 'angular-auth-oidc-client';

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  
  isAuthenticated$: any

  constructor(
    private eventService: PublicEventsService,
    private oidcSecurityService: OidcSecurityService
  ) { 
   }
  

  checkSessionChangedWithSpecificEvent(eventType: EventTypes) {
    this.eventService
    .registerForEvents()
    .pipe(filter((notification) => notification.type === eventType))
    .subscribe((value) => {
      console.log('CheckSessionChanged with value ', value.value)
    });
  }

  checkSessionChanged() {
    this.eventService
    .registerForEvents()
    .subscribe((value) => {
      console.log('CheckSessionChanged with value ', value)
    });
  }

  checkIfAuthenticated() {
    this.oidcSecurityService.checkAuth().subscribe(
      value => {
        console.log('Checking If Authenticated: ', value.isAuthenticated);
      }
    )
    // console.log('Checking If Authenticated: ', this.isAuthenticated$);
    
  }
}
