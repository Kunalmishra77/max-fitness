# Demo data

| File | Purpose |
|---|---|
| `members_demo.csv` | 220 fictional members for seeding staging/demo. `scenario` drives relative dates (see `docs/05-engineering/demo-data-seed-spec.md`). Mobiles use a fake `+9190000xxxxx` pattern and emails use `@example.com` — **never** send real messages to them. |
| `member_import_template.csv` | Template the owner/staff fill from the paper register for CRM → Import. Dates are DD-MM-YYYY. |

Birthday scenarios store only `dob_year`; the seed sets month/day relative to the run date.
