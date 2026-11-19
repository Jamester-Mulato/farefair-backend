/* Auto-generated snapshot of assets/data (8 cities).
 * Regenerate after editing city datasets: node tool/generate_admin_snapshot.mjs
 * The dashboard prefers live JSON assets when served; this keeps file:// demos working. */
window.FAREFAIR_SNAPSHOT = {
  "config": {
    "schemaVersion": 1,
    "activeCityId": "cabadbaran",
    "cities": [
      {
        "id": "cabadbaran",
        "asset": "assets/data/cities/cabadbaran.json"
      },
      {
        "id": "davao",
        "asset": "assets/data/cities/davao.json"
      },
      {
        "id": "cagayan_de_oro",
        "asset": "assets/data/cities/cagayan_de_oro.json"
      },
      {
        "id": "general_santos",
        "asset": "assets/data/cities/general_santos.json"
      },
      {
        "id": "zamboanga",
        "asset": "assets/data/cities/zamboanga.json"
      },
      {
        "id": "butuan",
        "asset": "assets/data/cities/butuan.json"
      },
      {
        "id": "iligan",
        "asset": "assets/data/cities/iligan.json"
      },
      {
        "id": "tagum",
        "asset": "assets/data/cities/tagum.json"
      }
    ]
  },
  "cities": {
    "cabadbaran": {
      "id": "cabadbaran",
      "displayName": "Cabadbaran City, Caraga",
      "province": "Agusan del Norte",
      "region": "Caraga (Region XIII)",
      "status": "active",
      "centroLabel": "Cabadbaran Centro",
      "center": {
        "lat": 9.1157,
        "lng": 125.5427
      },
      "provenance": {
        "provisional": true,
        "source": "Placeholder fare matrix pending the official Cabadbaran City LGU fare ordinance",
        "lastVerified": null
      },
      "farePolicy": {
        "discountRate": 0.2,
        "customaryLeewayMin": 0.92,
        "customaryLeewayMax": 1.12,
        "minPassengers": 1,
        "maxPassengers": 6,
        "pakyawSeatCap": 4
      },
      "demoRoute": {
        "originName": "Cabadbaran City Hall",
        "destinationName": "Cabadbaran Public Market",
        "distanceKm": 2.4
      },
      "vehicles": [
        {
          "vehicleId": "tricycle",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1,
          "perKmRate": 2.5,
          "minFare": 12,
          "maxCustomary": 65,
          "typicalCapacity": 4,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        },
        {
          "vehicleId": "habal-habal",
          "active": true,
          "baseFare": 25,
          "baseDistanceKm": 2,
          "perKmRate": 10,
          "minFare": 20,
          "maxCustomary": 90,
          "typicalCapacity": 2,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        },
        {
          "vehicleId": "skylab",
          "active": true,
          "baseFare": 35,
          "baseDistanceKm": 2,
          "perKmRate": 12,
          "minFare": 30,
          "maxCustomary": 140,
          "typicalCapacity": 6,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        },
        {
          "vehicleId": "jeepney",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 16,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        },
        {
          "vehicleId": "multicab",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 12,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        },
        {
          "vehicleId": "motorela",
          "active": true,
          "baseFare": 12,
          "baseDistanceKm": 1,
          "perKmRate": 2,
          "minFare": 10,
          "maxCustomary": 30,
          "typicalCapacity": 6,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        },
        {
          "vehicleId": "trisikad",
          "active": true,
          "baseFare": 10,
          "baseDistanceKm": 0.5,
          "perKmRate": 5,
          "minFare": 10,
          "maxCustomary": 25,
          "typicalCapacity": 2,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        },
        {
          "vehicleId": "bao-bao",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1.5,
          "perKmRate": 3,
          "minFare": 15,
          "maxCustomary": 55,
          "typicalCapacity": 3,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        },
        {
          "vehicleId": "modern-puj",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 4,
          "perKmRate": 2.2,
          "minFare": 15,
          "maxCustomary": 42,
          "typicalCapacity": 22,
          "regulationMatrix": "Provisional matrix — pending Cabadbaran City LGU fare ordinance"
        }
      ],
      "ordinances": [
        {
          "id": "cabadbaran-trike-provisional",
          "title": "Cabadbaran City Tricycle Fare Matrix (Provisional)",
          "municipality": "Cabadbaran City, Agusan del Norte",
          "ordinanceNumber": "Pending Sangguniang Panlungsod ordinance",
          "dateEnacted": "Pending LGU issuance",
          "summary": "Provisional tricycle tariff guide for Cabadbaran City proper and barangay routes pending official LGU publication.",
          "vehicleApplicability": "Tricycle, Bao-bao, Trisikad",
          "baseFare": 15,
          "succeedingKmRate": 2.5,
          "discountTerms": "Statutory 20% discount for students, seniors and PWDs (RA 9442 / RA 9994)."
        },
        {
          "id": "cabadbaran-habal-provisional",
          "title": "Cabadbaran Habal-Habal Customary Rate Guide (Provisional)",
          "municipality": "Cabadbaran City, Agusan del Norte",
          "ordinanceNumber": "Pending transport federation & LGU validation",
          "dateEnacted": "Pending LGU issuance",
          "summary": "Provisional customary pricing benchmark for habal-habal and skylab motorcycles serving upland barangay and farm-to-market roads.",
          "vehicleApplicability": "Habal-habal, Skylab",
          "baseFare": 25,
          "succeedingKmRate": 10,
          "discountTerms": "Voluntary discount practice pending LGU confirmation."
        }
      ],
      "simulatorCorridor": [
        [
          9.1157,
          125.5427
        ],
        [
          9.1171,
          125.5443
        ],
        [
          9.1143,
          125.5495
        ],
        [
          9.1095,
          125.5538
        ],
        [
          9.1035,
          125.5576
        ]
      ]
    },
    "davao": {
      "id": "davao",
      "displayName": "Davao City, Mindanao",
      "province": "Davao del Sur",
      "region": "Davao Region (XI)",
      "status": "candidate",
      "centroLabel": "Davao Centro",
      "center": {
        "lat": 7.0709,
        "lng": 125.58
      },
      "provenance": {
        "provisional": true,
        "source": "Placeholder dataset — unofficial customary rates pending LGU validation",
        "lastVerified": null
      },
      "farePolicy": {
        "discountRate": 0.2,
        "customaryLeewayMin": 0.92,
        "customaryLeewayMax": 1.12,
        "minPassengers": 1,
        "maxPassengers": 6,
        "pakyawSeatCap": 4
      },
      "demoRoute": {
        "originName": "Bankerohan Public Market",
        "destinationName": "Matina Aplaya Beach Rd",
        "distanceKm": 3.8
      },
      "vehicles": [
        {
          "vehicleId": "tricycle",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1,
          "perKmRate": 2.5,
          "minFare": 12,
          "maxCustomary": 65,
          "typicalCapacity": 4,
          "regulationMatrix": "Davao City Ordinance No. 0334-12 / CDO Ord. 2023-14A"
        },
        {
          "vehicleId": "habal-habal",
          "active": true,
          "baseFare": 25,
          "baseDistanceKm": 2,
          "perKmRate": 10,
          "minFare": 20,
          "maxCustomary": 90,
          "typicalCapacity": 2,
          "regulationMatrix": "Mindanao Customary Barangay Mountain Guideline"
        },
        {
          "vehicleId": "skylab",
          "active": true,
          "baseFare": 35,
          "baseDistanceKm": 2,
          "perKmRate": 12,
          "minFare": 30,
          "maxCustomary": 140,
          "typicalCapacity": 6,
          "regulationMatrix": "Upland Barangay Council Resolution Matrix"
        },
        {
          "vehicleId": "jeepney",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 16,
          "regulationMatrix": "LTFRB Region XI Official Fare Matrix"
        },
        {
          "vehicleId": "multicab",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 12,
          "regulationMatrix": "LTFRB Region X & XI Matrix"
        },
        {
          "vehicleId": "motorela",
          "active": true,
          "baseFare": 12,
          "baseDistanceKm": 1,
          "perKmRate": 2,
          "minFare": 10,
          "maxCustomary": 30,
          "typicalCapacity": 6,
          "regulationMatrix": "City of Cagayan de Oro Ordinance No. 2023-14A"
        },
        {
          "vehicleId": "trisikad",
          "active": true,
          "baseFare": 10,
          "baseDistanceKm": 0.5,
          "perKmRate": 5,
          "minFare": 10,
          "maxCustomary": 25,
          "typicalCapacity": 2,
          "regulationMatrix": "Barangay Federation Customary Tariff"
        },
        {
          "vehicleId": "bao-bao",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1.5,
          "perKmRate": 3,
          "minFare": 15,
          "maxCustomary": 55,
          "typicalCapacity": 3,
          "regulationMatrix": "LGU Tricycle Franchising & Regulatory Board"
        },
        {
          "vehicleId": "modern-puj",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 4,
          "perKmRate": 2.2,
          "minFare": 15,
          "maxCustomary": 42,
          "typicalCapacity": 22,
          "regulationMatrix": "LTFRB PUVMP Nationwide Matrix"
        }
      ],
      "ordinances": [
        {
          "id": "dvo-trike-2023",
          "title": "Davao City Motorized Tricycle Tariff Schedule",
          "municipality": "Davao City, Region XI",
          "ordinanceNumber": "City Ordinance No. 0334-12 (Series of 2023 Update)",
          "dateEnacted": "March 15, 2023",
          "summary": "Standardized rate for urban & suburban tricycles within Davao City limits including Matina, Buhangin, Toril, and Bankerohan zones.",
          "vehicleApplicability": "Tricycle, Bao-bao",
          "baseFare": 15,
          "succeedingKmRate": 2.5,
          "discountTerms": "20% statutory discount for students, PWDs, and senior citizens upon presentation of valid ID."
        },
        {
          "id": "ltfrb-puj-xi",
          "title": "LTFRB Region XI Public Utility Jeepney Fare Matrix",
          "municipality": "Mindanao Inter-City / Provincial",
          "ordinanceNumber": "LTFRB Resolution No. 2023-PUV-11",
          "dateEnacted": "October 8, 2023",
          "summary": "Authorized nationwide fare guide for traditional and modernized jeepneys across Region XI and Region XII routes.",
          "vehicleApplicability": "Traditional PUJ, Modern PUJ, Multicab",
          "baseFare": 13,
          "succeedingKmRate": 1.8,
          "discountTerms": "20% discount for Students (including weekends & holidays), Seniors, and PWDs."
        },
        {
          "id": "marawi-habal-2023",
          "title": "Bangsamoro Autonomous Region Hinterland Transit Guidelines",
          "municipality": "BARMM / Northern Mindanao",
          "ordinanceNumber": "Customary Transportation Advisory 08-B",
          "dateEnacted": "November 2, 2023",
          "summary": "Customary pricing benchmark for habal-habal motorcycle operators traversing upland and unpaved farm-to-market pathways.",
          "vehicleApplicability": "Habal-habal, Skylab",
          "baseFare": 25,
          "succeedingKmRate": 10,
          "discountTerms": "Voluntary senior and student consideration by transport federation."
        }
      ],
      "simulatorCorridor": [
        [
          7.0895,
          125.6035
        ],
        [
          7.0802,
          125.5922
        ],
        [
          7.0688,
          125.5841
        ],
        [
          7.0576,
          125.5788
        ],
        [
          7.0498,
          125.572
        ]
      ]
    },
    "cagayan_de_oro": {
      "id": "cagayan_de_oro",
      "displayName": "Cagayan de Oro, Northern Mindanao",
      "province": "Misamis Oriental",
      "region": "Northern Mindanao (X)",
      "status": "candidate",
      "centroLabel": "CDO Centro",
      "center": {
        "lat": 8.4825,
        "lng": 124.6539
      },
      "provenance": {
        "provisional": true,
        "source": "Placeholder dataset — unofficial customary rates pending LGU validation",
        "lastVerified": null
      },
      "farePolicy": {
        "discountRate": 0.2,
        "customaryLeewayMin": 0.92,
        "customaryLeewayMax": 1.12,
        "minPassengers": 1,
        "maxPassengers": 6,
        "pakyawSeatCap": 4
      },
      "demoRoute": {
        "originName": "Agora Bus Terminal",
        "destinationName": "Divisoria Plaza",
        "distanceKm": 3.2
      },
      "vehicles": [
        {
          "vehicleId": "tricycle",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1,
          "perKmRate": 2.5,
          "minFare": 12,
          "maxCustomary": 65,
          "typicalCapacity": 4,
          "regulationMatrix": "Davao City Ordinance No. 0334-12 / CDO Ord. 2023-14A"
        },
        {
          "vehicleId": "habal-habal",
          "active": true,
          "baseFare": 25,
          "baseDistanceKm": 2,
          "perKmRate": 10,
          "minFare": 20,
          "maxCustomary": 90,
          "typicalCapacity": 2,
          "regulationMatrix": "Mindanao Customary Barangay Mountain Guideline"
        },
        {
          "vehicleId": "skylab",
          "active": true,
          "baseFare": 35,
          "baseDistanceKm": 2,
          "perKmRate": 12,
          "minFare": 30,
          "maxCustomary": 140,
          "typicalCapacity": 6,
          "regulationMatrix": "Upland Barangay Council Resolution Matrix"
        },
        {
          "vehicleId": "jeepney",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 16,
          "regulationMatrix": "LTFRB Region XI Official Fare Matrix"
        },
        {
          "vehicleId": "multicab",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 12,
          "regulationMatrix": "LTFRB Region X & XI Matrix"
        },
        {
          "vehicleId": "motorela",
          "active": true,
          "baseFare": 12,
          "baseDistanceKm": 1,
          "perKmRate": 2,
          "minFare": 10,
          "maxCustomary": 30,
          "typicalCapacity": 6,
          "regulationMatrix": "City of Cagayan de Oro Ordinance No. 2023-14A"
        },
        {
          "vehicleId": "trisikad",
          "active": true,
          "baseFare": 10,
          "baseDistanceKm": 0.5,
          "perKmRate": 5,
          "minFare": 10,
          "maxCustomary": 25,
          "typicalCapacity": 2,
          "regulationMatrix": "Barangay Federation Customary Tariff"
        },
        {
          "vehicleId": "bao-bao",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1.5,
          "perKmRate": 3,
          "minFare": 15,
          "maxCustomary": 55,
          "typicalCapacity": 3,
          "regulationMatrix": "LGU Tricycle Franchising & Regulatory Board"
        },
        {
          "vehicleId": "modern-puj",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 4,
          "perKmRate": 2.2,
          "minFare": 15,
          "maxCustomary": 42,
          "typicalCapacity": 22,
          "regulationMatrix": "LTFRB PUVMP Nationwide Matrix"
        }
      ],
      "ordinances": [
        {
          "id": "cdo-motorela-2023",
          "title": "Cagayan de Oro Motorela Regulatory Framework",
          "municipality": "Cagayan de Oro City, Region X",
          "ordinanceNumber": "City Ordinance No. 2023-14A",
          "dateEnacted": "June 20, 2023",
          "summary": "Regulates fare matrix for 6-8 passenger Motorelas operating from Agora Bus Terminal, Divisoria, and Carmen districts.",
          "vehicleApplicability": "Motorela",
          "baseFare": 12,
          "succeedingKmRate": 2,
          "discountTerms": "Mandatory 20% discount; strictly prohibits unapproved cargo surcharge on standard personal luggage."
        },
        {
          "id": "ltfrb-puj-xi",
          "title": "LTFRB Region XI Public Utility Jeepney Fare Matrix",
          "municipality": "Mindanao Inter-City / Provincial",
          "ordinanceNumber": "LTFRB Resolution No. 2023-PUV-11",
          "dateEnacted": "October 8, 2023",
          "summary": "Authorized nationwide fare guide for traditional and modernized jeepneys across Region XI and Region XII routes.",
          "vehicleApplicability": "Traditional PUJ, Modern PUJ, Multicab",
          "baseFare": 13,
          "succeedingKmRate": 1.8,
          "discountTerms": "20% discount for Students (including weekends & holidays), Seniors, and PWDs."
        },
        {
          "id": "marawi-habal-2023",
          "title": "Bangsamoro Autonomous Region Hinterland Transit Guidelines",
          "municipality": "BARMM / Northern Mindanao",
          "ordinanceNumber": "Customary Transportation Advisory 08-B",
          "dateEnacted": "November 2, 2023",
          "summary": "Customary pricing benchmark for habal-habal motorcycle operators traversing upland and unpaved farm-to-market pathways.",
          "vehicleApplicability": "Habal-habal, Skylab",
          "baseFare": 25,
          "succeedingKmRate": 10,
          "discountTerms": "Voluntary senior and student consideration by transport federation."
        }
      ],
      "simulatorCorridor": [
        [
          8.4903,
          124.6601
        ],
        [
          8.4868,
          124.657
        ],
        [
          8.4842,
          124.6549
        ],
        [
          8.4825,
          124.6539
        ],
        [
          8.4795,
          124.6519
        ]
      ]
    },
    "general_santos": {
      "id": "general_santos",
      "displayName": "General Santos City, Soccsksargen",
      "province": "South Cotabato",
      "region": "Soccsksargen (XII)",
      "status": "candidate",
      "centroLabel": "Gensan Centro",
      "center": {
        "lat": 6.1164,
        "lng": 125.1717
      },
      "provenance": {
        "provisional": true,
        "source": "Placeholder dataset — unofficial customary rates pending LGU validation",
        "lastVerified": null
      },
      "farePolicy": {
        "discountRate": 0.2,
        "customaryLeewayMin": 0.92,
        "customaryLeewayMax": 1.12,
        "minPassengers": 1,
        "maxPassengers": 6,
        "pakyawSeatCap": 4
      },
      "demoRoute": {
        "originName": "Pioneer Avenue",
        "destinationName": "General Santos Public Market",
        "distanceKm": 3.5
      },
      "vehicles": [
        {
          "vehicleId": "tricycle",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1,
          "perKmRate": 2.5,
          "minFare": 12,
          "maxCustomary": 65,
          "typicalCapacity": 4,
          "regulationMatrix": "Davao City Ordinance No. 0334-12 / CDO Ord. 2023-14A"
        },
        {
          "vehicleId": "habal-habal",
          "active": true,
          "baseFare": 25,
          "baseDistanceKm": 2,
          "perKmRate": 10,
          "minFare": 20,
          "maxCustomary": 90,
          "typicalCapacity": 2,
          "regulationMatrix": "Mindanao Customary Barangay Mountain Guideline"
        },
        {
          "vehicleId": "skylab",
          "active": true,
          "baseFare": 35,
          "baseDistanceKm": 2,
          "perKmRate": 12,
          "minFare": 30,
          "maxCustomary": 140,
          "typicalCapacity": 6,
          "regulationMatrix": "Upland Barangay Council Resolution Matrix"
        },
        {
          "vehicleId": "jeepney",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 16,
          "regulationMatrix": "LTFRB Region XI Official Fare Matrix"
        },
        {
          "vehicleId": "multicab",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 12,
          "regulationMatrix": "LTFRB Region X & XI Matrix"
        },
        {
          "vehicleId": "motorela",
          "active": true,
          "baseFare": 12,
          "baseDistanceKm": 1,
          "perKmRate": 2,
          "minFare": 10,
          "maxCustomary": 30,
          "typicalCapacity": 6,
          "regulationMatrix": "City of Cagayan de Oro Ordinance No. 2023-14A"
        },
        {
          "vehicleId": "trisikad",
          "active": true,
          "baseFare": 10,
          "baseDistanceKm": 0.5,
          "perKmRate": 5,
          "minFare": 10,
          "maxCustomary": 25,
          "typicalCapacity": 2,
          "regulationMatrix": "Barangay Federation Customary Tariff"
        },
        {
          "vehicleId": "bao-bao",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1.5,
          "perKmRate": 3,
          "minFare": 15,
          "maxCustomary": 55,
          "typicalCapacity": 3,
          "regulationMatrix": "LGU Tricycle Franchising & Regulatory Board"
        },
        {
          "vehicleId": "modern-puj",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 4,
          "perKmRate": 2.2,
          "minFare": 15,
          "maxCustomary": 42,
          "typicalCapacity": 22,
          "regulationMatrix": "LTFRB PUVMP Nationwide Matrix"
        }
      ],
      "ordinances": [
        {
          "id": "gensan-trike-2024",
          "title": "General Santos City Tricycle Franchising Fare Guide",
          "municipality": "General Santos City, Region XII",
          "ordinanceNumber": "Sangguniang Panlungsod Ord. 2024-05",
          "dateEnacted": "January 12, 2024",
          "summary": "Standard passenger tariff guidelines for tricycles within Pioneer Avenue, Lagao, Bula, and Calumpang.",
          "vehicleApplicability": "Tricycle",
          "baseFare": 15,
          "succeedingKmRate": 2.25,
          "discountTerms": "Strict compliance with Republic Act 9442 and RA 9994 discount privileges."
        },
        {
          "id": "ltfrb-puj-xi",
          "title": "LTFRB Region XI Public Utility Jeepney Fare Matrix",
          "municipality": "Mindanao Inter-City / Provincial",
          "ordinanceNumber": "LTFRB Resolution No. 2023-PUV-11",
          "dateEnacted": "October 8, 2023",
          "summary": "Authorized nationwide fare guide for traditional and modernized jeepneys across Region XI and Region XII routes.",
          "vehicleApplicability": "Traditional PUJ, Modern PUJ, Multicab",
          "baseFare": 13,
          "succeedingKmRate": 1.8,
          "discountTerms": "20% discount for Students (including weekends & holidays), Seniors, and PWDs."
        }
      ],
      "simulatorCorridor": [
        [
          6.1291,
          125.1571
        ],
        [
          6.1231,
          125.1638
        ],
        [
          6.1164,
          125.1717
        ],
        [
          6.1098,
          125.1783
        ],
        [
          6.1042,
          125.1837
        ]
      ]
    },
    "zamboanga": {
      "id": "zamboanga",
      "displayName": "Zamboanga City, Zamboanga Peninsula",
      "province": "Zamboanga del Sur",
      "region": "Zamboanga Peninsula (IX)",
      "status": "candidate",
      "centroLabel": "Zamboanga Centro",
      "center": {
        "lat": 6.9214,
        "lng": 122.079
      },
      "provenance": {
        "provisional": true,
        "source": "Placeholder dataset — unofficial customary rates pending LGU validation",
        "lastVerified": null
      },
      "farePolicy": {
        "discountRate": 0.2,
        "customaryLeewayMin": 0.92,
        "customaryLeewayMax": 1.12,
        "minPassengers": 1,
        "maxPassengers": 6,
        "pakyawSeatCap": 4
      },
      "demoRoute": {
        "originName": "Zamboanga City Hall",
        "destinationName": "Zamboanga Public Market",
        "distanceKm": 3
      },
      "vehicles": [
        {
          "vehicleId": "tricycle",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1,
          "perKmRate": 2.5,
          "minFare": 12,
          "maxCustomary": 65,
          "typicalCapacity": 4,
          "regulationMatrix": "Davao City Ordinance No. 0334-12 / CDO Ord. 2023-14A"
        },
        {
          "vehicleId": "habal-habal",
          "active": true,
          "baseFare": 25,
          "baseDistanceKm": 2,
          "perKmRate": 10,
          "minFare": 20,
          "maxCustomary": 90,
          "typicalCapacity": 2,
          "regulationMatrix": "Mindanao Customary Barangay Mountain Guideline"
        },
        {
          "vehicleId": "skylab",
          "active": true,
          "baseFare": 35,
          "baseDistanceKm": 2,
          "perKmRate": 12,
          "minFare": 30,
          "maxCustomary": 140,
          "typicalCapacity": 6,
          "regulationMatrix": "Upland Barangay Council Resolution Matrix"
        },
        {
          "vehicleId": "jeepney",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 16,
          "regulationMatrix": "LTFRB Region XI Official Fare Matrix"
        },
        {
          "vehicleId": "multicab",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 12,
          "regulationMatrix": "LTFRB Region X & XI Matrix"
        },
        {
          "vehicleId": "motorela",
          "active": true,
          "baseFare": 12,
          "baseDistanceKm": 1,
          "perKmRate": 2,
          "minFare": 10,
          "maxCustomary": 30,
          "typicalCapacity": 6,
          "regulationMatrix": "City of Cagayan de Oro Ordinance No. 2023-14A"
        },
        {
          "vehicleId": "trisikad",
          "active": true,
          "baseFare": 10,
          "baseDistanceKm": 0.5,
          "perKmRate": 5,
          "minFare": 10,
          "maxCustomary": 25,
          "typicalCapacity": 2,
          "regulationMatrix": "Barangay Federation Customary Tariff"
        },
        {
          "vehicleId": "bao-bao",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1.5,
          "perKmRate": 3,
          "minFare": 15,
          "maxCustomary": 55,
          "typicalCapacity": 3,
          "regulationMatrix": "LGU Tricycle Franchising & Regulatory Board"
        },
        {
          "vehicleId": "modern-puj",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 4,
          "perKmRate": 2.2,
          "minFare": 15,
          "maxCustomary": 42,
          "typicalCapacity": 22,
          "regulationMatrix": "LTFRB PUVMP Nationwide Matrix"
        }
      ],
      "ordinances": [
        {
          "id": "zamboanga-trike-provisional",
          "title": "Zamboanga City Tricycle Fare Guide (Provisional)",
          "municipality": "Zamboanga City, Region IX",
          "ordinanceNumber": "Pending LGU validation",
          "dateEnacted": "Pending LGU issuance",
          "summary": "Provisional tricycle tariff placeholder for Zamboanga City proper pending official LGU publication.",
          "vehicleApplicability": "Tricycle, Bao-bao, Trisikad",
          "baseFare": 15,
          "succeedingKmRate": 2.5,
          "discountTerms": "Statutory 20% discount privileges (RA 9442 / RA 9994)."
        },
        {
          "id": "ltfrb-puj-xi",
          "title": "LTFRB Region XI Public Utility Jeepney Fare Matrix",
          "municipality": "Mindanao Inter-City / Provincial",
          "ordinanceNumber": "LTFRB Resolution No. 2023-PUV-11",
          "dateEnacted": "October 8, 2023",
          "summary": "Authorized nationwide fare guide for traditional and modernized jeepneys across Region XI and Region XII routes.",
          "vehicleApplicability": "Traditional PUJ, Modern PUJ, Multicab",
          "baseFare": 13,
          "succeedingKmRate": 1.8,
          "discountTerms": "20% discount for Students (including weekends & holidays), Seniors, and PWDs."
        }
      ],
      "simulatorCorridor": [
        [
          6.9136,
          122.073
        ],
        [
          6.9174,
          122.076
        ],
        [
          6.9214,
          122.079
        ],
        [
          6.925,
          122.0818
        ],
        [
          6.9286,
          122.0848
        ]
      ]
    },
    "butuan": {
      "id": "butuan",
      "displayName": "Butuan City, Caraga",
      "province": "Agusan del Norte",
      "region": "Caraga (Region XIII)",
      "status": "candidate",
      "centroLabel": "Butuan Centro",
      "center": {
        "lat": 8.9487,
        "lng": 125.543
      },
      "provenance": {
        "provisional": true,
        "source": "Placeholder dataset — unofficial customary rates pending LGU validation",
        "lastVerified": null
      },
      "farePolicy": {
        "discountRate": 0.2,
        "customaryLeewayMin": 0.92,
        "customaryLeewayMax": 1.12,
        "minPassengers": 1,
        "maxPassengers": 6,
        "pakyawSeatCap": 4
      },
      "demoRoute": {
        "originName": "Butuan City Hall",
        "destinationName": "Langihan Bus Terminal",
        "distanceKm": 3.4
      },
      "vehicles": [
        {
          "vehicleId": "tricycle",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1,
          "perKmRate": 2.5,
          "minFare": 12,
          "maxCustomary": 65,
          "typicalCapacity": 4,
          "regulationMatrix": "Davao City Ordinance No. 0334-12 / CDO Ord. 2023-14A"
        },
        {
          "vehicleId": "habal-habal",
          "active": true,
          "baseFare": 25,
          "baseDistanceKm": 2,
          "perKmRate": 10,
          "minFare": 20,
          "maxCustomary": 90,
          "typicalCapacity": 2,
          "regulationMatrix": "Mindanao Customary Barangay Mountain Guideline"
        },
        {
          "vehicleId": "skylab",
          "active": true,
          "baseFare": 35,
          "baseDistanceKm": 2,
          "perKmRate": 12,
          "minFare": 30,
          "maxCustomary": 140,
          "typicalCapacity": 6,
          "regulationMatrix": "Upland Barangay Council Resolution Matrix"
        },
        {
          "vehicleId": "jeepney",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 16,
          "regulationMatrix": "LTFRB Region XI Official Fare Matrix"
        },
        {
          "vehicleId": "multicab",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 12,
          "regulationMatrix": "LTFRB Region X & XI Matrix"
        },
        {
          "vehicleId": "motorela",
          "active": true,
          "baseFare": 12,
          "baseDistanceKm": 1,
          "perKmRate": 2,
          "minFare": 10,
          "maxCustomary": 30,
          "typicalCapacity": 6,
          "regulationMatrix": "City of Cagayan de Oro Ordinance No. 2023-14A"
        },
        {
          "vehicleId": "trisikad",
          "active": true,
          "baseFare": 10,
          "baseDistanceKm": 0.5,
          "perKmRate": 5,
          "minFare": 10,
          "maxCustomary": 25,
          "typicalCapacity": 2,
          "regulationMatrix": "Barangay Federation Customary Tariff"
        },
        {
          "vehicleId": "bao-bao",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1.5,
          "perKmRate": 3,
          "minFare": 15,
          "maxCustomary": 55,
          "typicalCapacity": 3,
          "regulationMatrix": "LGU Tricycle Franchising & Regulatory Board"
        },
        {
          "vehicleId": "modern-puj",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 4,
          "perKmRate": 2.2,
          "minFare": 15,
          "maxCustomary": 42,
          "typicalCapacity": 22,
          "regulationMatrix": "LTFRB PUVMP Nationwide Matrix"
        }
      ],
      "ordinances": [
        {
          "id": "butuan-trike-provisional",
          "title": "Butuan City Tricycle Fare Guide (Provisional)",
          "municipality": "Butuan City, Caraga",
          "ordinanceNumber": "Pending LGU validation",
          "dateEnacted": "Pending LGU issuance",
          "summary": "Provisional tricycle tariff placeholder for Butuan City proper pending official LGU publication.",
          "vehicleApplicability": "Tricycle, Bao-bao, Trisikad",
          "baseFare": 15,
          "succeedingKmRate": 2.5,
          "discountTerms": "Statutory 20% discount privileges (RA 9442 / RA 9994)."
        },
        {
          "id": "ltfrb-puj-xi",
          "title": "LTFRB Region XI Public Utility Jeepney Fare Matrix",
          "municipality": "Mindanao Inter-City / Provincial",
          "ordinanceNumber": "LTFRB Resolution No. 2023-PUV-11",
          "dateEnacted": "October 8, 2023",
          "summary": "Authorized nationwide fare guide for traditional and modernized jeepneys across Region XI and Region XII routes.",
          "vehicleApplicability": "Traditional PUJ, Modern PUJ, Multicab",
          "baseFare": 13,
          "succeedingKmRate": 1.8,
          "discountTerms": "20% discount for Students (including weekends & holidays), Seniors, and PWDs."
        }
      ],
      "simulatorCorridor": [
        [
          8.9454,
          125.5476
        ],
        [
          8.9487,
          125.543
        ],
        [
          8.9521,
          125.534
        ],
        [
          8.9548,
          125.527
        ],
        [
          8.9562,
          125.521
        ]
      ]
    },
    "iligan": {
      "id": "iligan",
      "displayName": "Iligan City, Lanao del Norte",
      "province": "Lanao del Norte",
      "region": "Northern Mindanao (X)",
      "status": "candidate",
      "centroLabel": "Iligan Centro",
      "center": {
        "lat": 8.228,
        "lng": 124.2452
      },
      "provenance": {
        "provisional": true,
        "source": "Placeholder dataset — unofficial customary rates pending LGU validation",
        "lastVerified": null
      },
      "farePolicy": {
        "discountRate": 0.2,
        "customaryLeewayMin": 0.92,
        "customaryLeewayMax": 1.12,
        "minPassengers": 1,
        "maxPassengers": 6,
        "pakyawSeatCap": 4
      },
      "demoRoute": {
        "originName": "Iligan City Plaza",
        "destinationName": "Iligan Public Market",
        "distanceKm": 2.8
      },
      "vehicles": [
        {
          "vehicleId": "tricycle",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1,
          "perKmRate": 2.5,
          "minFare": 12,
          "maxCustomary": 65,
          "typicalCapacity": 4,
          "regulationMatrix": "Davao City Ordinance No. 0334-12 / CDO Ord. 2023-14A"
        },
        {
          "vehicleId": "habal-habal",
          "active": true,
          "baseFare": 25,
          "baseDistanceKm": 2,
          "perKmRate": 10,
          "minFare": 20,
          "maxCustomary": 90,
          "typicalCapacity": 2,
          "regulationMatrix": "Mindanao Customary Barangay Mountain Guideline"
        },
        {
          "vehicleId": "skylab",
          "active": true,
          "baseFare": 35,
          "baseDistanceKm": 2,
          "perKmRate": 12,
          "minFare": 30,
          "maxCustomary": 140,
          "typicalCapacity": 6,
          "regulationMatrix": "Upland Barangay Council Resolution Matrix"
        },
        {
          "vehicleId": "jeepney",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 16,
          "regulationMatrix": "LTFRB Region XI Official Fare Matrix"
        },
        {
          "vehicleId": "multicab",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 12,
          "regulationMatrix": "LTFRB Region X & XI Matrix"
        },
        {
          "vehicleId": "motorela",
          "active": true,
          "baseFare": 12,
          "baseDistanceKm": 1,
          "perKmRate": 2,
          "minFare": 10,
          "maxCustomary": 30,
          "typicalCapacity": 6,
          "regulationMatrix": "City of Cagayan de Oro Ordinance No. 2023-14A"
        },
        {
          "vehicleId": "trisikad",
          "active": true,
          "baseFare": 10,
          "baseDistanceKm": 0.5,
          "perKmRate": 5,
          "minFare": 10,
          "maxCustomary": 25,
          "typicalCapacity": 2,
          "regulationMatrix": "Barangay Federation Customary Tariff"
        },
        {
          "vehicleId": "bao-bao",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1.5,
          "perKmRate": 3,
          "minFare": 15,
          "maxCustomary": 55,
          "typicalCapacity": 3,
          "regulationMatrix": "LGU Tricycle Franchising & Regulatory Board"
        },
        {
          "vehicleId": "modern-puj",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 4,
          "perKmRate": 2.2,
          "minFare": 15,
          "maxCustomary": 42,
          "typicalCapacity": 22,
          "regulationMatrix": "LTFRB PUVMP Nationwide Matrix"
        }
      ],
      "ordinances": [
        {
          "id": "iligan-trike-provisional",
          "title": "Iligan City Tricycle Fare Guide (Provisional)",
          "municipality": "Iligan City, Region X",
          "ordinanceNumber": "Pending LGU validation",
          "dateEnacted": "Pending LGU issuance",
          "summary": "Provisional tricycle tariff placeholder for Iligan City proper pending official LGU publication.",
          "vehicleApplicability": "Tricycle, Bao-bao, Trisikad",
          "baseFare": 15,
          "succeedingKmRate": 2.5,
          "discountTerms": "Statutory 20% discount privileges (RA 9442 / RA 9994)."
        },
        {
          "id": "ltfrb-puj-xi",
          "title": "LTFRB Region XI Public Utility Jeepney Fare Matrix",
          "municipality": "Mindanao Inter-City / Provincial",
          "ordinanceNumber": "LTFRB Resolution No. 2023-PUV-11",
          "dateEnacted": "October 8, 2023",
          "summary": "Authorized nationwide fare guide for traditional and modernized jeepneys across Region XI and Region XII routes.",
          "vehicleApplicability": "Traditional PUJ, Modern PUJ, Multicab",
          "baseFare": 13,
          "succeedingKmRate": 1.8,
          "discountTerms": "20% discount for Students (including weekends & holidays), Seniors, and PWDs."
        }
      ],
      "simulatorCorridor": [
        [
          8.224,
          124.241
        ],
        [
          8.226,
          124.2435
        ],
        [
          8.228,
          124.2452
        ],
        [
          8.2302,
          124.247
        ],
        [
          8.2324,
          124.249
        ]
      ]
    },
    "tagum": {
      "id": "tagum",
      "displayName": "Tagum City, Davao del Norte",
      "province": "Davao del Norte",
      "region": "Davao Region (XI)",
      "status": "candidate",
      "centroLabel": "Tagum Centro",
      "center": {
        "lat": 7.447,
        "lng": 125.8096
      },
      "provenance": {
        "provisional": true,
        "source": "Placeholder dataset — unofficial customary rates pending LGU validation",
        "lastVerified": null
      },
      "farePolicy": {
        "discountRate": 0.2,
        "customaryLeewayMin": 0.92,
        "customaryLeewayMax": 1.12,
        "minPassengers": 1,
        "maxPassengers": 6,
        "pakyawSeatCap": 4
      },
      "demoRoute": {
        "originName": "Tagum City Hall",
        "destinationName": "Tagum Public Market",
        "distanceKm": 3
      },
      "vehicles": [
        {
          "vehicleId": "tricycle",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1,
          "perKmRate": 2.5,
          "minFare": 12,
          "maxCustomary": 65,
          "typicalCapacity": 4,
          "regulationMatrix": "Davao City Ordinance No. 0334-12 / CDO Ord. 2023-14A"
        },
        {
          "vehicleId": "habal-habal",
          "active": true,
          "baseFare": 25,
          "baseDistanceKm": 2,
          "perKmRate": 10,
          "minFare": 20,
          "maxCustomary": 90,
          "typicalCapacity": 2,
          "regulationMatrix": "Mindanao Customary Barangay Mountain Guideline"
        },
        {
          "vehicleId": "skylab",
          "active": true,
          "baseFare": 35,
          "baseDistanceKm": 2,
          "perKmRate": 12,
          "minFare": 30,
          "maxCustomary": 140,
          "typicalCapacity": 6,
          "regulationMatrix": "Upland Barangay Council Resolution Matrix"
        },
        {
          "vehicleId": "jeepney",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 16,
          "regulationMatrix": "LTFRB Region XI Official Fare Matrix"
        },
        {
          "vehicleId": "multicab",
          "active": true,
          "baseFare": 13,
          "baseDistanceKm": 4,
          "perKmRate": 1.8,
          "minFare": 13,
          "maxCustomary": 35,
          "typicalCapacity": 12,
          "regulationMatrix": "LTFRB Region X & XI Matrix"
        },
        {
          "vehicleId": "motorela",
          "active": true,
          "baseFare": 12,
          "baseDistanceKm": 1,
          "perKmRate": 2,
          "minFare": 10,
          "maxCustomary": 30,
          "typicalCapacity": 6,
          "regulationMatrix": "City of Cagayan de Oro Ordinance No. 2023-14A"
        },
        {
          "vehicleId": "trisikad",
          "active": true,
          "baseFare": 10,
          "baseDistanceKm": 0.5,
          "perKmRate": 5,
          "minFare": 10,
          "maxCustomary": 25,
          "typicalCapacity": 2,
          "regulationMatrix": "Barangay Federation Customary Tariff"
        },
        {
          "vehicleId": "bao-bao",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 1.5,
          "perKmRate": 3,
          "minFare": 15,
          "maxCustomary": 55,
          "typicalCapacity": 3,
          "regulationMatrix": "LGU Tricycle Franchising & Regulatory Board"
        },
        {
          "vehicleId": "modern-puj",
          "active": true,
          "baseFare": 15,
          "baseDistanceKm": 4,
          "perKmRate": 2.2,
          "minFare": 15,
          "maxCustomary": 42,
          "typicalCapacity": 22,
          "regulationMatrix": "LTFRB PUVMP Nationwide Matrix"
        }
      ],
      "ordinances": [
        {
          "id": "tagum-trike-provisional",
          "title": "Tagum City Tricycle Fare Guide (Provisional)",
          "municipality": "Tagum City, Region XI",
          "ordinanceNumber": "Pending LGU validation",
          "dateEnacted": "Pending LGU issuance",
          "summary": "Provisional tricycle tariff placeholder for Tagum City proper pending official LGU publication.",
          "vehicleApplicability": "Tricycle, Bao-bao, Trisikad",
          "baseFare": 15,
          "succeedingKmRate": 2.5,
          "discountTerms": "Statutory 20% discount privileges (RA 9442 / RA 9994)."
        },
        {
          "id": "ltfrb-puj-xi",
          "title": "LTFRB Region XI Public Utility Jeepney Fare Matrix",
          "municipality": "Mindanao Inter-City / Provincial",
          "ordinanceNumber": "LTFRB Resolution No. 2023-PUV-11",
          "dateEnacted": "October 8, 2023",
          "summary": "Authorized nationwide fare guide for traditional and modernized jeepneys across Region XI and Region XII routes.",
          "vehicleApplicability": "Traditional PUJ, Modern PUJ, Multicab",
          "baseFare": 13,
          "succeedingKmRate": 1.8,
          "discountTerms": "20% discount for Students (including weekends & holidays), Seniors, and PWDs."
        }
      ],
      "simulatorCorridor": [
        [
          7.4428,
          125.8053
        ],
        [
          7.445,
          125.8075
        ],
        [
          7.447,
          125.8096
        ],
        [
          7.4493,
          125.812
        ],
        [
          7.4515,
          125.8144
        ]
      ]
    }
  }
};
