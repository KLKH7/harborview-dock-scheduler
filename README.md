# Harborview Dock Scheduling

**Live:** https://harborview-dock-scheduler.vercel.app
**Source:** https://github.com/KLKH7/harborview-dock-scheduler

A system for managing berth reservations at a marine research facility, built from 23 years
of existing schedule data (1997–2019).

The two problems stated in the brief were that staff had to **check for double-bookings by
eye** and **manually verify that a vessel fits its berth**. Both are now computed, on every
booking, historical and new.

---

## What it does

| Screen | Purpose |
|---|---|
| **Schedule** | The berth by day grid, and where bookings are made. Drag along a row to select days; the drag stops where the berth is taken. Overlapping stays stack in separate lanes, so a double booking makes the row visibly taller before any colour is read. Hover or click a bar and that hull is traced everywhere it appears. |
| **Problems** | Every stay in 23 years, checked by the rules that refuse a new one: two in one berth, one vessel in two berths, too long for the berth. Oversize is grouped by vessel and berth so 113 stays become 25 decisions, each fixable inline. Ends with what the data cannot tell us. |
| **Vessels** | The roster. Name and length; a length set here is what the fit check uses. |

The reserve panel is also a finder: give dates and a length and every berth is sorted into
free and long enough, too short, or occupied, before a berth is chosen.

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
prefix stripped raises coverage from 63 booked days to 2,253.

### 4. A month block is not a stay

The workbook draws each month as its own block, so a stay from 28 January to 3 February is
two colour bands on two blocks. A per-month walk emits two rows. **89 stays** were rejoined
in a post-pass (same berth, same label, last day of one month to first of the next).
Conflict detection was never affected, but every night count on them was wrong.

Sheets 2002 to 2004 also open with the *previous* year's December, so December 2001, 2002
and 2003 were each extracted twice. Only 3 rows were exact duplicates; the two copies mostly
differ, which means the coordinator kept editing one and not the other. The duplicates are
dropped, the rest kept, and the disagreement is reported rather than resolved, because the
sheet is the only witness.

---

## Key decisions

### Dates are inclusive: `[start, end]`

A booking API would normally use half-open `[start, end)`, where a vessel departing on the
17th frees the berth for one arriving the 17th. **That is wrong for this data.** The source
is a day-grid in which a filled cell means "occupied that day" — a run ending on the 17th
means the vessel was physically there on the 17th.

This is not cosmetic. Under half-open semantics every same-day handover silently becomes
legal, which would erase most of what the archive reports. Inclusive semantics are kept, and
a new booking sharing even one day is refused.

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

### Overlap and oversize refuse. There is no override

A new booking that overlaps another, or puts a vessel in a berth shorter than it, is refused
outright.

Overlap is refused *during the drag* rather than after it: the bar stops growing at the last
free day, so the wrong thing is never expressible and no error message is needed. Oversize
cannot work that way, because the vessel is not known until it is named, so that one refuses
in the panel with the numbers spelled out, alongside a list of berths that would fit.

The same-day turnaround that earlier versions allowed is gone. Before removing it I checked
the archive: in 23 years **no two different vessels share exactly one day**, so the allowance
was protecting a case the data never contains.

### There are two kinds of double-booking, and a grid only shows one

"Two things in this berth" is what everyone checks, and what the grid makes visible. "This
vessel is already in *another* berth" is invisible on a grid, because each berth looks fine on
its own. The archive holds **18** of these; 8 share a single day, which is what a berth shift
looks like and is allowed, and **10 share 2 to 14 days**, which a hull cannot do.

`detectDoubleAssignment` is a second detector beside `detectOverlaps`. Both grade history and
both gate a new booking: any same-berth overlap refuses; a cross-berth overlap of two or more
days refuses; a one-day shift is reported and allowed.

I found this gap by brute-forcing every pair and comparing to the engine. The engine matched
on same-berth pairs exactly, and the exercise surfaced the class it never looked for.

### Tracing a hull replaces the spreadsheet's colour coding

The source workbook gave each regular vessel a fixed fill colour. This was a real system:
180 of 208 coloured hulls wore exactly one colour across 23 years, and the busiest was 100%
consistent over 237 runs. It answered "where else is this vessel this month" without reading
a label. It also did not survive its own tail: only 49% of stays had any colour, the
mid-frequency vessels drifted between hues, and red did double duty as an identity and as
"no usage permitted".

So the question is answered on demand. Hover or click a bar and that hull is traced across
the whole view; the other bars recede rather than the match brightening, which keeps one
accent meaning one thing. It scales to all 431 vessels and cannot drift, because identity
comes from the data rather than from remembering which purple. No entrance animation, since
it fires every time the pointer crosses a bar; a 120ms opacity change and nothing under
`prefers-reduced-motion`. Click pins it for keyboard and touch; Escape clears.

### One validation engine, not two

`lib/validation/engine.ts` is pure — no database, no `fetch`, no `Date.now()`. It is imported
by both the import path and the grid, so the rules applied to the historical archive
and to a new reservation provably cannot drift apart. It has 38 unit tests covering the
inclusive-boundary cases, containment, unknown lengths, events, both conflict classes, and
refusal.

---

## What the system found

| | |
|---|---|
| Stays imported | **2,077** (Aug 1997 to Dec 2019) |
| Two stays in one berth | **2** |
| One vessel in two berths | **10** (plus 8 same-day shifts, allowed) |
| Too long for the berth | **113** stays, across **25** vessel and berth pairings |
| Cannot be fit-checked | **1,404** (5,051 booked days) |
| Events and dock notes (no vessel) | **106** |

The worst overhang is `R/V Long Anchor` (170 ft) in `North Pier Face` (75 ft), 95 feet too
long. But the biggest *group* is `S/V Far Horizon` in `South Float East`, **47 times** over
the years, which is not 49 mistakes. It is one question: is the roster length wrong, or does
that berth tolerate the overhang? The problems page asks it once, with the fix inline.

The same-berth double-bookings are both a vessel booked during a multi-day facility closure,
which is exactly the class of error a grid makes easy to miss.

Only 2 same-berth conflicts in 23 years is a low number, and it is a real result rather than
a silent failure: verified by re-reading the raw cells for the months in question, by an
independent audit script (`npm run audit`) that recounts the workbook without reusing the
extractor's logic, and by brute-forcing every pair of stays and comparing to the engine.

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
- **Editing a stay in place.** A stay can be removed from its hover card and re-made; moving
  its dates by dragging the bar is not built.
- **Uploading a new .xlsx at runtime** — the extraction is the hard part and it is already
  done; re-doing it in a serverless request adds risk without adding capability.
- **Retired berths over time** — the `8YR Dock Summary` tab references berths that appear in
  no grid (`Marsh Landing`), so the facility clearly changed shape over 23 years. The schema
  admits this; no UI is built for it.
- **Mobile layout, drag-to-reschedule, recurring bookings, notifications.**

### The honest limitation

I could not determine a length for **1,404 stays**. Those are reported as *unverifiable*
rather than approved. The foot of the problems page ranks the missing vessels by how much schedule they occupy,
so the gap is actionable rather than merely acknowledged.
