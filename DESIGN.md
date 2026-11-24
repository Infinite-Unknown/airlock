# Airlock design

Airlock is a working tool for front-desk, support and HR staff. It has to feel calm, clerical and trustworthy, like a well-kept paper form, and make one thing obvious at a glance: what stays on this device and what leaves it.

## Direction

- **Paper and ink.** Warm off-white page, near-black ink, hairline rules. No gradients, no glass.
- **Two meanings of colour, used nowhere else.** Green means "on this device". Amber means "leaves this device". The middle panel is the airlock: amber dashed boundaries and a faint hatched fill.
- **Placeholders are data.** Tokens like `[PERSON_1]` and the egress payload are set in a monospace face, colour-coded by kind of detail. Mono is used for data only.
- **Light only.** The use scene is an office desk in daylight; a dark theme is not shipped.

## Tokens (`src/style.css`, `:root`)

| Role | Token | Value |
|---|---|---|
| Page | `--bg` | `#f4f2ec` |
| Surface | `--surface` | `#fffdf8` |
| Field | `--field` | `#ffffff` |
| Ink | `--ink` | `#1d1f1c` |
| Secondary text | `--muted` | `#5f625a` (AA on page and surface) |
| Hairline | `--line` | `#dcd8cc` |
| On this device | `--device`, `--device-soft` | `#0f5132`, `#e3efe7` |
| Leaves this device | `--cloud`, `--cloud-soft` | `#8a4b08`, `#f8ecdc` |
| Warning | `--warn`, `--warn-soft` | `#7a4f00`, `#fff3d6` |
| Error | `--err`, `--err-soft` | `#a12a1f`, `#fde8e5` |

- **Type:** IBM Plex Sans (400/500/600) for UI, IBM Plex Mono (400/500) for tokens and payloads, self-hosted via Fontsource. Scale: 12 / 13 / 14 / 15 (body) / 19 (panel title) / 26 (app title). Tabular numerals for counts and times.
- **Spacing:** 4-based scale `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32, `--s7` 48.
- **Radius:** `--r-sm` 6 (tokens, small controls), `--r-md` 8 (fields, buttons), `--r-lg` 14 (panels, log).
- **Shadow:** one, for raised surfaces: `0 1px 2px rgba(29,31,28,.04), 0 8px 24px -12px rgba(29,31,28,.12)`.

## Layout

- Header: logo + name + one-line promise on the left, two status chips on the right (label / value).
- Three panels in one joined card: 1 Message (on this device), 2 What the cloud will see (leaves this device), 3 Result (back on this device). Each panel opens with a tinted zone band naming its side of the boundary.
- Egress log below: a running tally and one row per request.
- At 960 px and below the panels stack; the airlock keeps its amber dashed top and bottom edges.

## Motion

Easing `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; transform, opacity and filter only, except the marker sweep (background-size on one inline element at a time).

- **First load:** header, panels and log rise 8 px and fade in, 60 ms apart, 420 ms each.
- **Redaction (the signature moment):** every detected value is first highlighted (260 ms), then struck by an ink marker sweeping left to right (240 ms), then its placeholder lands in its place (blur 4 px → 0, scale .9 → 1, 260 ms). Values go in reading order, 140 ms apart. Hidden details rows arrive in step. Interrupting (Show/Hide, a new redaction) finishes the sequence at once.
- **Manual hide:** only the newly hidden value plays the sweep.
- **Restore:** the reverse. Placeholders in the answer dissolve into the real values, highlighted green.
- **Egress log:** a new row drops in (6 px, 260 ms) with a short amber wash that fades over 1.2 s; the tally updates.
- **Feedback:** buttons scale to .97 on press (120 ms); hover states only on fine pointers.
- **Reduced motion:** no movement and no sweep; placeholders and rows cross-fade (150 ms).
