# iCapture Export

## Background

iCapture has a **Lead Upload Tool** (post-Cvent acquisition) that accepts CSV/XLSX of completed leads with custom field mapping. There is **no public write API** as of May 2026, so CSV export is the official integration path.

What the user originally remembered as a "post-event matrix" is the standard export-edit-reimport workflow that this Lead Upload Tool now formalizes.

## Schema setup

Page: `app/(setup)/shows/[id]/lead-form/page.tsx`.

1. Rep pastes a sample iCapture CSV export (header row + ideally one example data row).
2. A server action runs Claude Sonnet to infer field types (text/select/multiselect/boolean/number), required-ness, and likely select options.
3. App writes `lead_forms` + `custom_field_definitions` rows.
4. Rep edits the inferred schema in a table UI before saving.
5. `custom_field_definitions.csv_header` preserves the **exact** header string iCapture expects, including punctuation and casing.

## AI extraction constraint

The Zod schema used by `extractBadge` and `extractTranscript` is **generated at runtime from `custom_field_definitions`** (`lib/ai/schemaBuilder.ts`):

- `text` → `z.string().optional()`
- `select` → `z.enum(options).optional()`
- `multiselect` → `z.array(z.enum(options)).optional()`
- `boolean` → `z.boolean().optional()`
- `number` → `z.number().optional()`

This guarantees model output drops straight into the CSV without further normalization.

## Export endpoint

`app/api/shows/[id]/export.csv/route.ts`:

- Auth: any rep on the show, or admin
- Streams CSV in `custom_field_definitions.csv_header` order
- One row per `leads` row
- Unfilled fields → empty string
- Trailing diagnostic columns: `_capture_count`, `_first_captured_at`, `_rep_emails` (can be deleted before upload if iCapture rejects extras)
- Records the export in `csv_exports` for audit
