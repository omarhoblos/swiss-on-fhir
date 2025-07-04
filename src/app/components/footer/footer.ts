import { Component } from '@angular/core';
import packageJson from '@src/package.json'
// import packageJson from '../../../../package.json'

@Component({
  selector: 'app-footer',
  imports: [],
  templateUrl: './footer.html',
  styleUrl: './footer.scss'
})
export class Footer {
  public version: string = packageJson.version;
  

}
