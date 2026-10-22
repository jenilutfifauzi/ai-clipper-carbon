# 08: Default Template for new Jobs

**Parent spec:** `../spec.md` (Model: default, JobOptions; Server: new Jobs, deleting a Template; MCP; Editor: New Job form).

**What to build:** one Template (or none) is my default. Every new Job's Candidates arrive with it, and I can pick another or none when I start a Job.

- **The store keeps the default Template's id**, or none.
  - Set and cleared over REST, and with `save_preset(kind="template", use_as_default=true)`.
  - Deleting the default clears it.
  - `list_presets` marks the default.
- **`JobOptions` gains the Job's Template:** the default when not given, an id, or none. It is resolved to an id or none when the Job is created.
- **Selection and `add_candidate`** apply the Job's Template to each new Candidate before its first save, so Revision 1 is branded.
  - If that Template is gone, the Candidates stay plain and the Job records a notice.
- **The New Job form** has a Template choice: the default (named), another, or none.
- **`create_job_from_url` and `create_job_from_file`** take it through their options.
- **The Templates tab** gains "Make default", and the star on the card shows it.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] HTTP with fake Selection:
  - A new Job with a default Template has branded Candidates at Revision 1.
  - "None" leaves them plain.
  - A Template deleted before Selection gives plain Candidates and a Job notice.
  - `add_candidate` applies the Job's Template.
  - Deleting the default clears it.
- [ ] MCP: `create_job_from_url` with a Template, and `use_as_default`.
- [ ] Vitest: the New Job form sends the chosen Template, or none.
