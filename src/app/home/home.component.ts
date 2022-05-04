import { Component, OnInit } from '@angular/core';
import { UtilService } from '@app/service/util.service';
import { OAuthService, AuthConfig } from 'angular-oauth2-oidc'

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {

  constructor(
    private oauthService: OAuthService,
    private utilService: UtilService,
  ) { 
    this.checkIfTokenIsInSession();
  }

  tokenObjectForDisplay = {
    accessToken: 'No Token Found',
    idToken: 'No Token Found',
    claims: {},
    decodedAccessToken: null,
    expirationDate: null
  };

  ngOnInit(): void {
  }

  returnTokenStatus() {
    return this.oauthService.hasValidAccessToken();
  }

  private checkIfTokenIsInSession() {
    if (this.oauthService.getAccessToken()?.length > 0) {
      this.tokenObjectForDisplay['accessToken'] = this.oauthService.getAccessToken();
      this.tokenObjectForDisplay['idToken'] = this.oauthService.getIdToken();
      this.tokenObjectForDisplay['refreshToken'] = this.oauthService.getRefreshToken();
      this.tokenObjectForDisplay['claims'] = this.oauthService.getIdentityClaims();
      this.tokenObjectForDisplay['claimsKeys'] = this.utilService.returnObjectKeys(this.oauthService.getIdentityClaims());
      this.tokenObjectForDisplay['decodedAccessTokenKeys'] = this.utilService.returnObjectKeys(this.utilService.decodeToken(this.oauthService.getAccessToken()));
      this.tokenObjectForDisplay['decodedAccessToken'] = this.utilService.decodeToken(this.oauthService.getAccessToken());
      this.tokenObjectForDisplay['expirationDate'] = new Date(this.oauthService.getAccessTokenExpiration());
    }
  }
  
  login() {
    this.oauthService.initCodeFlow();
  }

  copyToClipboard(value: string) {
    this.utilService.copyToClipboard(value);
  }
}
