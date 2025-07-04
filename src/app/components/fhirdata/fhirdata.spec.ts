import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Fhirdata } from './fhirdata';

describe('Fhirdata', () => {
  let component: Fhirdata;
  let fixture: ComponentFixture<Fhirdata>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Fhirdata]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Fhirdata);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
