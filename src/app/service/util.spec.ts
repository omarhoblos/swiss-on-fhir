import { TestBed } from '@angular/core/testing';

import { Util } from './util';

describe('Util', () => {
  let service: Util;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Util);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
