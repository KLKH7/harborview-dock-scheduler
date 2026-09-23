# Harborview Dock Scheduling

**Live:** https://harborview-dock-scheduler.vercel.app

A system for managing berth reservations at a marine research facility, built from 23 years
of existing schedule data (1997–2019).

The two problems stated in the brief were that staff had to **check for double-bookings by
eye** and **manually verify that a vessel fits its berth**. Both are now computed, on every
booking, historical and new.

---

## What it does

| Screen | Purpose |
|---|---|
| **Schedule** | The familiar berth × day grid, but every bar is coloured by what the system found. Overlapping bookings are stacked in separate lanes so a collision is impossible to miss. |
| **Findings** | Every double-booking and every oversized vessel across all 23 years, ranked. This replaces reading the grid. |
| **New booking** | Validates live as you type — conflicts and berth fit — before anything is saved. |
| **Data quality** | What the source data cannot tell us, and what it would take to fix. |

---

## The three things that make this data hard

I want to be explicit about these, because each one silently corrupts the result if missed.

### 1. Booking duration is encoded in cell *fill colour*, not text

A multi-day stay is a contiguous band of coloured cells. The vessel name appears as text only
in the **first** cell of the run:

```
North Pier West │ R/V CLEAR SEXTANT │▓▓▓│▓▓▓│▓▓▓│▓▓▓│ …   ← one 31-day booking
                 └ text here only    └── colour band carries the rest
```

Reading `cell.value` alone yields thousands of bogus one-day bookings and destroys every
duration. A third encoding also appears in some years: the name repeated in *every* cell of
the stay. The extractor handles all three.

### 2. The 1997–2001 sheets store day numbers as uncached formulas

Those sheets contain `=SUM(B3+1)` rather than a number, with no cached result. Both
`data_only=true` and `data_only=false` fail — one sees a formula object, the other sees
nothing. The day numbers are reconstructed arithmetically from the anchor `1`.

**This reconstruction is verified, not trusted.** Every month grid carries its own
weekday-letter row (`M T W TR F S S`), which is an independent witness to the dates. The
extractor asserts its reconstruction against it:

```
month blocks: 272, weekday-verified: 267
```

The remaining 5 are reported rather than hidden: 3 are blocks whose weekday letters are
uniformly offset by 1–2 days (a template pasted from another year and never corrected — the
day numbers win, and the sheet is flagged on the Data Quality page), and 2 have no readable
weekday row. A *non-uniform* disagreement would mean the column→day mapping itself is broken,
and that throws rather than producing plausible-looking wrong dates.

### 3. Vessel lengths are not in the schedule at all

They live only in the `Science` / `Yachts` roster tabs, embedded in the name string
(`R/V High Drift 120'`). Joining them is fuzzy, because the two sources disagree about
prefixes:

| Schedule says | Roster says |
|---|---|
| `R/V Clear Sextant` | `S/Y Clear Sextant 145'` |
| `R/V Long Anchor` | `Tug Long Anchor 170'` |

**58 of 78 matched vessels have a different prefix.** Matching on the hull name with the
prefix stripped raises coverage from 63 booked days to 2,255.

---

## Key decisions

### Dates are inclusive: `[start, end]`

A booking API would normally use half-open `[start, end)`, where a vessel departing on the
17th frees the berth for one arriving the 17th. **That is wrong for this data.** The source
is a day-grid in which a filled cell means "occupied that day" — a run ending on the 17th
means the vessel was physically there on the 17th.

This is not cosmetic. Under half-open semantics every same-day handover silently becomes
legal. Inclusive semantics are kept, and a one-day overlap is graded a *warning* (plausible
turnaround) rather than a *violation*.

### Fit has four states, not two

```ts
type FitStatus = 'fits' | 'violation' | 'unverifiable' | 'not_applicable'
```

`unverifiable` is the important one. **1,454 bookings — 5,051 booked days — reference vessels
with no length recorded anywhere in the workbook**, including the busiest (`R/V Golden
Compass`, 1,445 days). Their fit cannot be computed.

Reporting those as "fits" would be a lie, and it is precisely the failure the system exists
to prevent. Reporting them as violations would bury the 115 real ones. So they are a separate
state with their own colour, their own count, and their own worklist — because the remedy is
different: a violation needs a human decision, an unverifiable needs *data*.

The same applies to berths. Two grouped areas (`North Finger Piers`, `Small craft slips`)
carry no length in the source, so a vessel placed there is also `unverifiable`. Their capacity
is stored as `null` — never `0` (which would flag everything) and never `Infinity` (which
would approve everything).

### "Is this a vessel?" is an allow-list, not a keyword search

Not every cell in the grid names a ship. The schedule is also used for annotations
(`ETA 1200`, `Departs 0600`, `Delayed due to weather`), facility work (`Bollard replacement,
west face`, `Float rebuild - no usage permitted`) and events (`Student tour`,
`Donor reception`).

My first version classified these with a keyword deny-list — `maintenance|repair|dredging|…`.
That can only catch the phrases you think of in advance, and it silently typed **85 bookings
as vessels that were nothing of the kind**, each then counted as a vessel of unknown length
and inflating the "cannot be fit-checked" total.

It is now an allow-list on the vessel prefix (`R/V`, `M/V`, `F/V`, `S/V`, `M/Y`, `S/Y`,
`OS/V`, `OSV`, `Tug`, `Barge`), which is exact rather than approximate because every genuine
vessel in this workbook carries one. Note `OS/V` as well as `OSV` — both spellings appear,
and missing the former dropped two vessels from the roster.

The prefix list lives in one module (`lib/vessel-name.ts`) rather than being repeated in each
script, because when `OS/V` turned up it had to be fixed everywhere or the scripts would
disagree about what counts as a vessel.

### History is observed; new bookings are governed

The 2 double-bookings and 115 oversized assignments already in the archive are **imported, not
rejected**. Dropping them would produce a database that disagrees with 23 years of reality and
would hide the very problem the brief describes. They become a reviewable backlog.

Validation blocks on *create*, not on *ingest*.

### A violation can be overridden, with a reason

Real waterfronts raft vessels and make judgment calls. A system that makes the correct action
impossible just gets worked around. A blocked booking can proceed if the user records a
reason, which is stored on the row. The override log is itself a feature.

### One validation engine, not two

`lib/validation/engine.ts` is pure — no database, no `fetch`, no `Date.now()`. It is imported
by both the import path and the booking form, so the rules applied to the historical archive
and to a new reservation provably cannot drift apart. It has 31 unit tests covering the
inclusive-boundary cases, containment, unknown lengths, and events.

---

## What the system found

| | |
|---|---|
| Reservations imported | **2,169** (Aug 1997 → Dec 2019) |
| Double-bookings | **2** (both ≥ 2 shared days) |
| Vessels exceeding their berth | **115** |
| Bookings that cannot be fit-checked | **1,454** (5,051 booked days) |
| Facility events and dock notes (no vessel) | **107** |

The worst overhang is `R/V Long Anchor` (170′) repeatedly assigned to `North Pier Face`
(75′) — 95 feet too long. The double-bookings are both a vessel booked into a berth during a
multi-day facility closure, which is exactly the class of error a grid makes easy to miss.

Only 2 conflicts in 23 years is a low number, and it is a real result rather than a silent
failure — verified by re-reading the raw cells for the months in question, and by an
independent audit script (`npm run audit`) that recounts the workbook without reusing the
extractor's logic and asserts that no booking was invented or lost.

---

## Architecture

```
scripts/extract.mts   .xlsx  → data/snapshot.json   (offline; never runs on Vercel)
scripts/roster.mts    roster → data/vessels.json    (fuzzy hull-name join)
scripts/audit.mts     independent re-count, asserts extraction invariants
scripts/seed.mts      snapshot → Postgres
lib/validation/       the pure engine + its tests
app/                  four screens, Server Components + Server Actions
```

Extraction is deliberately **offline**. The snapshot is committed, so it is deterministic,
diffable, reviewable, and a broken database can never block the demo. The database earns its
place because the brief says *manage* — new bookings must persist.

**Stack:** Next.js (App Router) · TypeScript · Neon Postgres · Tailwind · Vitest.

---

## Running it

```bash
npm install
npm test                        # 31 engine tests
npm run extract                 # rebuild snapshot from data/source.xlsx (see note)
npm run audit                   # verify the extraction independently
npm run seed                    # load Postgres (needs DATABASE_URL)
npm run dev
```

`npm test` works on a fresh clone with no setup — the engine is pure, so its tests need
neither the workbook nor a database.

The source workbook is **not committed** (it is the employer's sample data, and a 394 KB
binary does not belong in git). `data/snapshot.json`, `data/vessels.json` and
`data/findings.json` — the extractor's committed output — are, so the app and the audit run
without it. To re-run `npm run extract` yourself, drop the sample workbook at
`data/source.xlsx` first.

---

## Scope, and what I deliberately left out

Built to the suggested 3–5 hours, so the following are **conscious omissions**, not oversights:

- **Auth / users** — single-tenant internal tool; the source data has no notion of identity.
- **Editing and deleting reservations** — create + validate demonstrates the engine; full CRUD
  is surface area, not signal.
- **Uploading a new .xlsx at runtime** — the extraction is the hard part and it is already
  done; re-doing it in a serverless request adds risk without adding capability.
- **Retired berths over time** — the `8YR Dock Summary` tab references berths that appear in
  no grid (`Marsh Landing`), so the facility clearly changed shape over 23 years. The schema
  admits this; no UI is built for it.
- **Mobile layout, drag-to-reschedule, recurring bookings, notifications.**

### The honest limitation

I could not determine a length for **1,454 bookings**. Those are reported as *unverifiable*
rather than approved. The Data Quality screen ranks the missing vessels by how much schedule
they occupy — recording a length for just the top ten would make 3,352 booked days
verifiable — so the gap is actionable rather than merely acknowledged.
