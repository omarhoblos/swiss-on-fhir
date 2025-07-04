import { Component, Input, OnInit } from '@angular/core';
import { errorObject } from '@interface/model'

@Component({
  selector: 'app-error',
  imports: [],
  templateUrl: './error.html',
  styleUrl: './error.scss'
})
export class Error {

   @Input() errorObject: errorObject = {
    flag: false,
    severity: '',
    msg: ''
  }
  constructor() { }

  ngOnInit(): void {
    this.addHelpfulText();
      
  }

  addHelpfulText() {
    if (this.errorObject.msg.toLowerCase().includes('unknown error')) {
      console.log('An unknown error occurred. Oopsie?');
      this.errorObject.msg += ' - This might be the result of bad headers, or CORS policy misconfiguration on the server. Check the console log for further details (if any)'
    }
  }
}
