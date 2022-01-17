import { Component, OnInit } from '@angular/core';
import { faCog, faHeart } from '@fortawesome/free-solid-svg-icons';
import { faGithubAlt, faLinkedin } from '@fortawesome/free-brands-svg-icons';
import packageJson from '../../../../package.json';

@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.css']
})
export class FooterComponent implements OnInit {

  public version: string = packageJson.version;

  faGithubAlt = faGithubAlt;
  faLinkedin = faLinkedin;
  faHeart = faHeart;

  constructor() { }

  ngOnInit(): void {
  }

}
