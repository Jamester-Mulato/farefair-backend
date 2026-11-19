# Overcharge detection: method and defence

This note records how FareFair decides whether a tricycle fare was overcharged, and why each
number in that decision can be traced back to a published row. It is written so that a panel, an
LTFRB officer or a barangay official can be handed a single trip and asked to check it.

## 1. What is being compared

The study compares two amounts:

| Amount | Where it comes from | Who may change it |
| --- | --- | --- |
| **Expected** | the published matrix row for that origin and destination | nobody — it is transcribed |
| **Paid** | what the passenger actually handed over | the rider, at recording time |

The verdict is the difference between them, nothing else.

**The expected amount is never taken from the app's own estimate.** The trip row already stores
`exact_fare`, which the app produced. Comparing a payment against it would be circular: any bug in
the estimate would look like an overcharge. Instead the service re-reads the matrix:

```text
fn_lookup_fare_route(city, vehicle, origin, destination)
  → row_number, regular_fare, discounted_fare
buildOfficialFare(...)
  → exact_fare = per-passenger fare × seat units
```

So the "ground truth" in this study is the ordinance, not the software.

## 2. Why the geometry matters

Cabadbaran prices tricycles with a **point-to-point table** (S.C.O. 2020-012). It publishes no
per-kilometre rule for tricycles. The LTFRB classes in the same app (jeepney, multicab,
modern-PUJ, UV Express, provincial bus) are priced **per kilometre** by a different instrument.

The two geometries are never mixed:

- a tricycle fare is only ever a printed row, a sum of printed rows, or a contract price;
- a per-kilometre engine is only ever applied to a class whose instrument publishes a rate.

This is why the overcharge module never contains the words "estimated fare". If the table has no
row for a pair, the result is `not_covered`, not a number.

## 3. The five verdicts

| Status | Meaning | What the app may claim |
| --- | --- | --- |
| `compliant` | the payment is within tolerance of the printed row | the fare matches |
| `overcharged` | the payment is above the row by more than tolerance | the payment exceeds the row |
| `undercharged` | the payment is below the row by more than tolerance | the payment falls short |
| `not_covered` | the matrix prints no row for this pair | nothing about the amount |
| `contract` | recorded as a direct hire, which the matrix treats as by agreement | nothing about the amount |

`not_covered` and `contract` are **not** overcharges. Treating an unlisted trip as an overcharge is
the single easiest way to make the study indefensible.

## 4. Tolerance and severity

- **Tolerance:** the active fare policy's `customary_leeway_max`; otherwise ₱1.00, the coin-rounding
  allowance. A ₱1 gap on a ₱9 minimum fare is not an overcharge.
- **Severity** (overcharge only):
  - `minor` — ≤ ₱5 or ≤ 10 %
  - `moderate` — ≤ ₱20 or ≤ 25 %
  - `serious` — anything larger

Severity is reported, but it never changes the status.

## 5. Explaining the gap

A verdict alone is not an explanation. The module generates ranked **hypotheses**, each one a
testable statement about the table:

| Code | Evidence | Example (real rows) |
| --- | --- | --- |
| `matched_other_row` | paid = another printed fare | Bugho ₱40, paid ₱50 = Puting Bato Centro (row 56) |
| `matched_adjacent_sitio` | …and that row is in the same barangay | Bugho ₱40, paid ₱35 = Dal-As / Bung-aw |
| `matched_unit_row` | paid ÷ passengers = another row's fare | charged the Calamba rate per head |
| `hub_link_added` | paid = row + the Poblacion↔Terminal link | Bay-ang ₱20 + ₱9 = ₱29 |
| `composed_as_single_hire` | paid = row + a second printed row | Bugho ₱40 + Caasinan ₱15 = ₱55 |
| `discount_missed` | paid = the undiscounted total | ₱40 charged where the student fare is ₱32 |
| `per_passenger_double` | paid = total × passengers | ₱80 charged for a ₱80 two-head total |
| `solo_double` | paid = 2 × fare, one passenger | ₱80 for a ₱40 row |
| `rounded_up` | small gap landing on a round amount | ₱40 → ₱45 |
| `surcharge_added` | gap that matches no row | ₱40 → ₱47 |
| `unlisted_place` | no row exists | any pair outside the 66 rows |
| `contract_hire` | direct hire | pakyaw outside the table |

Two conventions keep these honest:

- **`solo_double` is named and denied in the same sentence.** The "special/solo trip = two passenger
  fares" clause belongs to *Cabanatuan City*. Cabadbaran's 17 July 2026 matrix prints no
  special-trip clause, so the doubling is a practice, not a rule.
- **A hypothesis is a statement about the table, not about the driver.** "₱50 is the Puting Bato
  Centro fare" is a fact. "The driver overcharged on purpose" is not in the data.

## 6. What the language model is allowed to do

The model is optional. With no provider configured the endpoint returns `engine.mode = "rules"` and
makes zero network calls.

When a provider is configured (NVIDIA NIM, Groq, Cerebras, OpenRouter, Google, or a local Ollama),
the model receives:

- the trip, the expected row and the payment;
- the computed status and delta;
- the ranked hypotheses;
- the printed rows that matched.

It returns `headline`, `explanation`, `mostLikely`, `reasoning` and `whatToCheck`
(and, optionally, `verdict`, which must equal the computed one).

`validateExplanation` rejects the whole response if any of these hold:

1. it contains a number that is not already in the packet or the hypotheses;
2. `mostLikely` is not one of the proposed cause codes;
3. `verdict` contradicts the computed status;
4. `headline` or `explanation` is missing.

A rejected or unavailable response falls back to the deterministic explanation. The model can
therefore improve the *wording* of an overcharge analysis, but it cannot create one, remove one, or
change the amount.

## 7. Reproducing a result

```bash
# start the API
cd backend && npm start

# rules only — deterministic, offline
curl "http://localhost:4000/v1/trips/$TRIP/overcharge?paid=50"

# with an NVIDIA-hosted model explaining the gap
# (nvidia/nemotron-3-ultra-550b-a55b; the 550B model needs 90-180 s to write
#  the narrative, and the endpoint answers 503 if tool_choice is sent)
# FAREFAIR_LLM_PROVIDER=nvidia
# FAREFAIR_LLM_API_KEY=nvapi-...
curl "http://localhost:4000/v1/trips/$TRIP/overcharge?paid=50"
```

The response carries `basis`, which is what a rider or officer should read first:

```text
published row 6: Poblacion or Terminal → Bugho, Bay-Ang at ₱40.00 per passenger × 1
S.C.O. 2020-012, effective 2026-07-17, provisional posting
paid ₱50.00
difference ₱10.00 (25.0%)
tolerance ₱1.00 (coin rounding allowance)
```

## 8. Limits, stated plainly

- **`paid` is self-reported.** The module knows what the rider says they handed over. A false report
  produces a false verdict; the study should say so.
- **Place detection has a floor.** Four labels have survey-grade coordinates, a handful more have
  purok points from the 2015 DENR–MGB sheets (±100–150 m), and the rest resolve at barangay level.
  Where a barangay prints several sitio fares, the rider picks the lugar, so a mis-pick looks like an
  overcharge.
- **Direct hires are outside the comparison.** Pakyaw is contracted, and the matrix prints no
  ceiling for it.
- **The instrument is time-bound.** S.C.O. 2020-012 is an emergency provisional ordinance whose
  §4 sunset restores C.O. 2009-17 on a normalcy declaration. The analysis cites the **17 July 2026
  posting** as the operative schedule, and excludes C.O. 2026-011 (voided by SP Resolution
  432-2026) and the never-posted 24 September 2026 board matrix.
- **Multi-ride trips are sums, not single fares.** A spoke-to-spoke trip is reported as two or three
  rides, each from a printed row, and never as one enacted fare.
- **A receipt is not a ride.** A fare can be quoted for any pair of labels, including a start-and-stop
  receipt with no movement. The app refuses the check unless the saved trail has at least four
  breadcrumbs, covers more than 20 m, and covers at least 40% of the priced route
  (`overchargeEvidenceFor` in `lib/services/overcharge_check.dart`). The HTTP endpoint assumes the
  trip row it reads came from a real recording; a batch run should filter on the stored breadcrumb
  count before treating a verdict as a measurement.

## 9. Paragraph for the paper

> Overcharging was measured as the difference between the fare printed in Cabadbaran City
> Ordinance No. 2020-012, as posted on 17 July 2026, and the amount a passenger reported paying for
> the same origin and destination. The expected amount was reconstructed from the ordinance row
> rather than taken from the application's own estimate, so the comparison is independent of the
> estimator under test. Differences within a ₱1.00 coin-rounding tolerance were classified as
> compliant; `not_covered` pairs, for which the ordinance prints no row, and `contract` (pakyaw)
> trips were excluded from the overcharge count rather than treated as violations. Each detected
> discrepancy was then matched against the published table to generate a ranked, testable
> explanation — for example, that the amount paid equals the fare printed for a different sitio in
> the same barangay, or that the Poblacion–Terminal link fare was added to a barangay fare. A
> language model was used only to render these rule-derived explanations in prose; any narrative
> containing a number not present in the computed record was rejected automatically, so the model
> could not introduce or alter a fare.

## 10. Files

| File | Role |
| --- | --- |
| `src/lib/overcharge.js` | pure comparison, classification, hypotheses, narrative validation |
| `src/services/overcharge-service.js` | rebuilds the expected amount from the matrix, optional model call |
| `src/routes/trips.js` | `GET`/`POST /v1/trips/:tripId/overcharge` |
| `test/overcharge.test.js` | 23 tests on the comparison rules |
| `test/overcharge-service.test.js` | wiring, prompt contents, model rejection, provider outage |
