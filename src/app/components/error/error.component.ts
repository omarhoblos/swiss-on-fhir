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

import { Component, Input, OnInit } from '@angular/core';
import { errorObject } from '@interface/models'

@Component({
  selector: 'app-error',
  templateUrl: './error.component.html',
  styleUrls: ['./error.component.css']
})
export class ErrorComponent implements OnInit {

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
      console.log('ding');
      
      this.errorObject.msg += ' - This might be the result of bad headers, or CORS policy misconfiguration on the server. Check the console log for further details (if any)'
    }
  }

}
