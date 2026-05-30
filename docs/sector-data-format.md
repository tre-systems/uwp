# Sector / subsector data format

UWP can **import** pasted sector or subsector data and **export** the same
canonical format, so you can bring your own worlds in and take generated ones
out. This document describes both supported formats and how each field is
encoded.

- Import lives in `src/domain/subsector/import.ts` (`parseSectorData`).
- Export lives in `src/domain/subsector/export.ts` (`subsectorToText`).
- The two are inverses on world-identity fields: `export → import → export` is
  idempotent on the data rows.

## Supported formats

The importer auto-detects which of two community formats you pasted:

1. **T5SS tab-delimited (primary).** A header row names the columns, and cells
   are separated by single tab characters. This is what UWP exports, and what
   most standard sector-map tools produce. Detected when a tab-delimited header
   contains both a `Hex` and a `UWP` column.
2. **Classic `.sec` fixed-width (secondary).** Column-positional, no header. Used
   by older sector files. Detected when the tab header is absent.

Lines that are blank or start with `#` are treated as comments and skipped.
A leading UTF-8 BOM and Windows (CRLF) line endings are tolerated.

## Coordinates

Every world is addressed by a 4-digit **hex** `XXYY`:

- `XX` = column, `01`–`32`
- `YY` = row, `01`–`40`

These are **sector-relative** and match UWP's internal coordinate space exactly,
so no translation happens on import. After import, the grid snaps to one of two
sizes based on how far the coordinates spread:

- any column `> 08` or row `> 10` → a full **32×40 sector**;
- otherwise → a single **8×10 subsector**.

The lettered subsector (A–P) a hex belongs to is derived from its coordinate;
it is not stored per world.

## Field encodings

### Extended hex (ehex)

Single-character digits use the standard extended-hex alphabet — values 0–33,
skipping the ambiguous letters `I` and `O`:

```
0123456789ABCDEFGH JKLMN PQRSTUVWXYZ
0        9 10    17 18 22 23        33
```

### UWP

The Universal World Profile is `Starport Size Atmosphere Hydrographics
Population Government Law - Tech`, e.g. `B564789-9`:

- **Starport**: `A`–`H`, or `X` (none) / `Y` (frontier), or `?` (unknown).
- **Size, Atmosphere, Hydrographics, Population, Government, Law**: six ehex
  digits.
- **Tech level**: one ehex digit after the `-`.
- `?` is accepted as a placeholder in any digit position.

The strict pattern is `[A-HXY?][0-9A-HJ-NP-Z?]{6}-[0-9A-HJ-NP-Z?]`.

### Bases

A short letter string. The four base slots UWP models map from these letters:

| Letter(s) | Base |
| --- | --- |
| `N`, `K` | Naval |
| `S` | Scout |
| `R`, `E` | Research |
| `A` | Aid |

Export emits only `N` / `S` / `R` / `A` so a round-trip restores the same four
flags. Unrecognised base letters are ignored.

### Travel zone

| Code | Zone |
| --- | --- |
| `A` | Amber |
| `R` | Red |
| (blank / other) | Green |

### PBG

Three ehex digits: **P**opulation multiplier, planetoid **B**elts, **G**as
giants — e.g. `703` = ×7 population multiplier, 0 belts, 3 gas giants.

### Allegiance

Up to four characters identifying the controlling polity (e.g. `Na` for
non-aligned). On import, each distinct allegiance code becomes a polity whose
capital is its highest-population world; the most common code becomes the
sector's dominant allegiance.

### Other columns

- **Remarks / trade codes** are ignored on import and recomputed from the UWP;
  export writes the derived codes back out.
- **Stars**, **{Ix}**, **(Ex)**, **[Cx]** are not modelled. Export writes the
  (blank) headers so the file is recognised as T5SS; import ignores them.

## What is synthesized

Survey data carries no random seed, so on import each world gets a deterministic
`system_seed` derived from its coordinate and UWP. The renderer can then show a
plausible system whose **main world matches the imported UWP** (atmosphere,
hydrographics, population, etc.); the other bodies are invented but consistent.

## Tolerant parsing

Each line is parsed independently. Malformed lines (bad hex, bad UWP, missing
fields) are collected and reported, and every line that *does* parse is still
imported. Duplicate coordinates resolve last-one-wins.

## T5SS column reference

The canonical export column set (tab-separated):

```
Sector  SS  Hex  Name  UWP  Bases  Remarks  Zone  PBG  Allegiance  Stars  {Ix}  (Ex)  [Cx]
```

Import reads these header names case-insensitively and needs only `Hex`, `Name`,
`UWP`, `Bases`, `Zone`, `PBG`, and `Allegiance`; column order is free.

## Classic `.sec` column reference

Fixed character columns (1-based, inclusive):

| Field | Columns |
| --- | --- |
| Name | 1–14 |
| Hex | 15–18 |
| UWP | 20–28 |
| Bases | 31 |
| Codes (trade) | 33–47 |
| Zone | 49 |
| PBG | 52–54 |
| Allegiance | 56–57 |
| Stellar | 59+ |

## Sample (T5SS tab-delimited)

This is a valid 8×10 subsector you can paste straight into the importer. Columns
are separated by **single tab characters** (not spaces).

```
Sector	SS	Hex	Name	UWP	Bases	Remarks	Zone	PBG	Allegiance	Stars	{Ix}	(Ex)	[Cx]
Kestrel	A	0103	Aenir	B564789-9	N	Ag Ni	G	703	Na	G2 V			
Kestrel	A	0207	Boraul	C7A5354-8	S	Fl	A	102	Na	M0 V			
Kestrel	A	0305	Cassia	A8B5887-C	NS	Ri	G	223	Na	F7 V			
Kestrel	A	0408	Dovrin	E430612-7		De Po	G	101	Na	K1 V			
Kestrel	A	0502	Ennis	X544300-5		Lo	R	504	Na	M3 V			
Kestrel	A	0609	Faltine	D200577-8	S	Va Ni	G	610	Na	G8 V			
Kestrel	A	0704	Gesh	B6747A9-A	N	Ag	G	823	Fd	K5 V			
```
