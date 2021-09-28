Post the following Bundle to the base of your FHIR Endpoint (eg: http://localhost:8000). Note, `ExplanationOfBenefit` does not include a search parameter for the `insurer` field by default, so this bundle includes one made for testing. If you do add this SP, you might need to re-index your data for the changes to reflect in your results.

```js
{
  "resourceType": "Bundle",
  "type": "transaction",
  "entry": [
    {
      "resource": {
        "resourceType": "Patient",
        "id": "patient-a",
        "name": [
          {
            "family": "Wonka",
            "given": [
              "Willy",
              "Billy"
            ]
          }
        ],
        "gender": "male",
        "birthDate": "1971-06-30",
        "address": [
          {
            "use": "home",
            "type": "both",
            "text": "534 Erewhon St PeasantVille, Rainbow, Vic  3999",
            "line": [
              "534 Erewhon St"
            ],
            "city": "PleasantVille",
            "district": "Rainbow",
            "state": "Vic",
            "postalCode": "3999",
            "period": {
              "start": "1974-12-25"
            }
          }
        ],
        "contact": [
          {
            "relationship": [
              {
                "coding": [
                  {
                    "system": "http://terminology.hl7.org/CodeSystem/v2-0131",
                    "code": "C"
                  }
                ]
              }
            ],
            "name": {
              "use": "usual",
              "family": "Abels",
              "given": [
                "Sarah"
              ]
            },
            "telecom": [
              {
                "system": "phone",
                "value": "0690383372",
                "use": "mobile"
              }
            ]
          }
        ]
      },
      "request": {
        "method": "PUT",
        "url": "Patient/patient-a"
      }
    },
    {
      "resource": {
        "resourceType": "SearchParameter",
        "id": "explanationofbenefit-insurer",
        "status": "active",
        "description": "The reference to the insurer",
        "code": "insurer",
        "base": [
          "ExplanationOfBenefit"
        ],
        "type": "reference",
        "expression": "ExplanationOfBenefit.insurer",
        "target": [
          "Organization"
        ]
      },
      "request": {
        "method": "PUT",
        "url": "SearchParameter/explanationofbenefit-insurer"
      }
    },
    {
      "resource": {
        "resourceType": "Organization",
        "id": "organization-a",
        "identifier": [
          {
            "system": "urn:oid:2.16.840.1.113883.3.19.2.3",
            "value": "666666"
          }
        ],
        "name": "Chocolate Factory Health Insurance",
        "alias": [
          "Chocolate Factory Health Insurance"
        ],
        "telecom": [
          {
            "system": "phone",
            "value": "+1 555 234 3523",
            "use": "mobile"
          },
          {
            "system": "email",
            "value": "info@chocofactory.org",
            "use": "work"
          }
        ],
        "address": [
          {
            "line": [
              "3300 Washtenaw Avenue, Suite 227"
            ],
            "city": "Ann Arbor",
            "state": "MI",
            "postalCode": "48104",
            "country": "USA"
          }
        ]
      },
      "request": {
        "method": "PUT",
        "url": "Organization/organization-a"
      }
    },
    {
      "resource": {
        "resourceType": "Organization",
        "id": "organization-b",
        "identifier": [
          {
            "system": "urn:ietf:rfc:3986",
            "value": "2.16.840.1.113883.19.5"
          }
        ],
        "name": "The Candyland Hospital",
        "telecom": [
          {
            "system": "phone",
            "value": "+1 555 234 1234",
            "use": "work"
          },
          {
            "system": "email",
            "value": "contact@candyland.com",
            "use": "work"
          }
        ],
        "address": [
          {
            "line": [
              "1375 E Buena Vista Dr"
            ],
            "city": "Orlando",
            "state": "FL",
            "postalCode": "48104",
            "country": "USA"
          }
        ]
      },
      "request": {
        "method": "PUT",
        "url": "Organization/organization-b"
      }
    },
    {
      "resource": {
        "resourceType": "Practitioner",
        "id": "practitioner-a",
        "text": {
          "status": "generated"
        },
        "identifier": [
          {
            "system": "http://www.acme.org/practitioners",
            "value": "23"
          }
        ],
        "active": true,
        "name": [
          {
            "family": "Nightingale",
            "given": [
              "Florence"
            ]
          }
        ],
        "address": [
          {
            "use": "home",
            "line": [
              "123 Candyland Crescent"
            ],
            "city": "Sugartopia",
            "state": "Vic",
            "postalCode": "3999"
          }
        ],
        "qualification": [
          {
            "code": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/v2-0360/2.7",
                  "code": "CNP",
                  "display": "Certified Nurse Practitioner"
                }
              ],
              "text": "Certified Nurse Practitioner"
            }
          }
        ]
      },
      "request": {
        "method": "PUT",
        "url": "Practitioner/practitioner-a"
      }
    },
    {
      "resource": {
        "resourceType": "Coverage",
        "id": "coverage-a",
        "text": {
          "status": "generated"
        },
        "identifier": [
          {
            "system": "http://benefitsinc.com/certificate",
            "value": "12345"
          }
        ],
        "status": "active",
        "type": {
          "coding": [
            {
              "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
              "code": "EHCPOL",
              "display": "extended healthcare"
            }
          ]
        },
        "subscriber": {
          "reference": "Patient/patient-a"
        },
        "beneficiary": {
          "reference": "Patient/patient-a"
        },
        "dependent": "0",
        "relationship": {
          "coding": [
            {
              "code": "self"
            }
          ]
        },
        "period": {
          "start": "2011-05-23",
          "end": "2021-06-23"
        },
        "payor": [
          {
            "reference": "Organization/organization-b"
          }
        ],
        "class": [
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "group"
                }
              ]
            },
            "value": "CB135",
            "name": "Corporate Baker's Inc. Local #35"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "subgroup"
                }
              ]
            },
            "value": "123",
            "name": "Trainee Part-time Benefits"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "plan"
                }
              ]
            },
            "value": "B37FC",
            "name": "Full Coverage: Medical, Dental, Pharmacy, Vision, EHC"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "subplan"
                }
              ]
            },
            "value": "P7",
            "name": "Includes afterlife benefits"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "class"
                }
              ]
            },
            "value": "SILVER",
            "name": "Silver: Family Plan spouse only"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "subclass"
                }
              ]
            },
            "value": "Tier2",
            "name": "Low deductable, max $20 copay"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "sequence"
                }
              ]
            },
            "value": "9"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "rxid"
                }
              ]
            },
            "value": "MDF12345"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "rxbin"
                }
              ]
            },
            "value": "987654"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "rxgroup"
                }
              ]
            },
            "value": "M35PT"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "rxpcn"
                }
              ]
            },
            "value": "234516"
          },
          {
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                  "code": "sequence"
                }
              ]
            },
            "value": "9"
          }
        ]
      },
      "request": {
        "method": "PUT",
        "url": "Coverage/coverage-a"
      }
    },
    {
      "resource": {
        "resourceType": "Claim",
        "id": "claim-a",
        "text": {
          "status": "generated"
        },
        "identifier": [
          {
            "system": "http://happyvalley.com/claim",
            "value": "12345"
          }
        ],
        "status": "active",
        "type": {
          "coding": [
            {
              "system": "http://terminology.hl7.org/CodeSystem/claim-type",
              "code": "oral"
            }
          ]
        },
        "use": "claim",
        "patient": {
          "reference": "Patient/patient-a"
        },
        "created": "2014-08-16",
        "insurer": {
          "reference": "Organization/organization-b"
        },
        "provider": {
          "reference": "Organization/organization-a"
        },
        "priority": {
          "coding": [
            {
              "code": "normal"
            }
          ]
        },
        "payee": {
          "type": {
            "coding": [
              {
                "code": "provider"
              }
            ]
          }
        },
        "careTeam": [
          {
            "sequence": 1,
            "provider": {
              "reference": "Practitioner/practitioner-a"
            }
          }
        ],
        "diagnosis": [
          {
            "sequence": 1,
            "diagnosisCodeableConcept": {
              "coding": [
                {
                  "code": "123456"
                }
              ]
            }
          }
        ],
        "insurance": [
          {
            "sequence": 1,
            "focal": true,
            "identifier": {
              "system": "http://happyvalley.com/claim",
              "value": "12345"
            },
            "coverage": {
              "reference": "Coverage/coverage-a"
            }
          }
        ],
        "item": [
          {
            "sequence": 1,
            "careTeamSequence": [
              1
            ],
            "productOrService": {
              "coding": [
                {
                  "code": "1200"
                }
              ]
            },
            "servicedDate": "2014-08-16",
            "unitPrice": {
              "value": 135.57,
              "currency": "USD"
            },
            "net": {
              "value": 135.57,
              "currency": "USD"
            }
          }
        ]
      },
      "request": {
        "method": "PUT",
        "url": "Claim/claim-a"
      }
    },
    {
      "resource": {
        "resourceType": "ExplanationOfBenefit",
        "id": "eob-a",
        "text": {
          "status": "generated"
        },
        "identifier": [
          {
            "system": "http://www.BenefitsInc.com/fhir/explanationofbenefit",
            "value": "987654321"
          }
        ],
        "status": "active",
        "type": {
          "coding": [
            {
              "system": "http://terminology.hl7.org/CodeSystem/claim-type",
              "code": "oral"
            }
          ]
        },
        "use": "claim",
        "patient": {
          "reference": "Patient/patient-a"
        },
        "created": "2014-08-16",
        "enterer": {
          "reference": "Practitioner/practitioner-a"
        },
        "insurer": {
          "reference": "Organization/organization-a"
        },
        "provider": {
          "reference": "Practitioner/practitioner-a"
        },
        "payee": {
          "type": {
            "coding": [
              {
                "system": "http://terminology.hl7.org/CodeSystem/payeetype",
                "code": "provider"
              }
            ]
          },
          "party": {
            "reference": "Organization/organization-b"
          }
        },
        "claim": {
          "reference": "Claim/claim-a"
        },
        "outcome": "complete",
        "disposition": "Claim settled as per contract.",
        "careTeam": [
          {
            "sequence": 1,
            "provider": {
              "reference": "Practitioner/practitioner-a"
            }
          }
        ],
        "insurance": [
          {
            "focal": true,
            "coverage": {
              "reference": "Coverage/coverage-a"
            }
          }
        ],
        "item": [
          {
            "sequence": 1,
            "careTeamSequence": [
              1
            ],
            "productOrService": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/ex-USCLS",
                  "code": "1205"
                }
              ]
            },
            "servicedDate": "2014-08-16",
            "unitPrice": {
              "value": 135.57,
              "currency": "USD"
            },
            "net": {
              "value": 135.57,
              "currency": "USD"
            },
            "adjudication": [
              {
                "category": {
                  "coding": [
                    {
                      "code": "eligible"
                    }
                  ]
                },
                "amount": {
                  "value": 120,
                  "currency": "USD"
                }
              },
              {
                "category": {
                  "coding": [
                    {
                      "code": "eligpercent"
                    }
                  ]
                },
                "value": 0.8
              },
              {
                "category": {
                  "coding": [
                    {
                      "code": "benefit"
                    }
                  ]
                },
                "amount": {
                  "value": 96,
                  "currency": "USD"
                }
              }
            ]
          },
          {
            "sequence": 2,
            "careTeamSequence": [
              1
            ],
            "productOrService": {
              "coding": [
                {
                  "code": "group"
                }
              ]
            },
            "servicedDate": "2014-08-16",
            "net": {
              "value": 200,
              "currency": "USD"
            },
            "adjudication": [
              {
                "category": {
                  "coding": [
                    {
                      "code": "benefit"
                    }
                  ]
                },
                "amount": {
                  "value": 180,
                  "currency": "USD"
                }
              }
            ],
            "detail": [
              {
                "sequence": 1,
                "productOrService": {
                  "coding": [
                    {
                      "code": "group"
                    }
                  ]
                },
                "net": {
                  "value": 200,
                  "currency": "USD"
                },
                "adjudication": [
                  {
                    "category": {
                      "coding": [
                        {
                          "code": "benefit"
                        }
                      ]
                    },
                    "amount": {
                      "value": 180,
                      "currency": "USD"
                    }
                  }
                ],
                "subDetail": [
                  {
                    "sequence": 1,
                    "productOrService": {
                      "coding": [
                        {
                          "system": "http://terminology.hl7.org/CodeSystem/ex-USCLS",
                          "code": "1205"
                        }
                      ]
                    },
                    "unitPrice": {
                      "value": 200,
                      "currency": "USD"
                    },
                    "net": {
                      "value": 200,
                      "currency": "USD"
                    },
                    "adjudication": [
                      {
                        "category": {
                          "coding": [
                            {
                              "code": "eligible"
                            }
                          ]
                        },
                        "amount": {
                          "value": 200,
                          "currency": "USD"
                        }
                      },
                      {
                        "category": {
                          "coding": [
                            {
                              "code": "eligpercent"
                            }
                          ]
                        },
                        "value": 0.9
                      },
                      {
                        "category": {
                          "coding": [
                            {
                              "code": "benefit"
                            }
                          ]
                        },
                        "amount": {
                          "value": 180,
                          "currency": "USD"
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        "total": [
          {
            "category": {
              "coding": [
                {
                  "code": "submitted"
                }
              ]
            },
            "amount": {
              "value": 135.57,
              "currency": "USD"
            }
          },
          {
            "category": {
              "coding": [
                {
                  "code": "benefit"
                }
              ]
            },
            "amount": {
              "value": 96,
              "currency": "USD"
            }
          }
        ]
      },
      "request": {
        "method": "PUT",
        "url": "ExplanationOfBenefit/eob-a"
      }
    }
  ]
}
```