# 0033: Account documents in Postgres, media on each machine

Status: accepted
Date: 2026-11-18

Builds on 0032 (account-scoped data behind Clerk). Amends 0032, 0027 and 0003 where noted.

## Context

Since 0032 each account's data is a private directory on the machine running the backend. The owner runs the app in two places, on a Mac and on a hosted server, and signs in to both with the same Clerk account: each showed its own Jobs, presets and settings. The owner wants what they made to be there wherever they sign in.

## Decision

- **An account's documents are rows in one Postgres when `DATABASE_URL` is set.** A document is a JSON file a store reads and writes whole: `job.json`, a Job's Transcript, Candidates, Revision History, Clips, Selection and Score answers, its Agent Threads; the Channel Profile, Style, Text and Export Presets, Templates, Starred effects; and the indexes of the Media Library, Logos, imported Faces and Looks. Each is one row of `documents`, keyed by the account (`sha256(sub)`, as its directory is named) and the path the file had in the account's directory.
- **One table of `jsonb`, not a table per shape.** The stores already validate with pydantic and upgrade older shapes as they read (`app/migration.py`); nothing queries inside a document. Typed columns would say all of that twice.
- **One seam, `Documents` (`app/documents.py`).** A store takes a `Document` (read, write, delete, version, and a block for read-modify-write) and neither knows nor cares where it is kept. `FileDocuments` keeps them as the files they always were: with no `DATABASE_URL`, in tests, and for the CLI's runs on the unassigned legacy root of 0032. `PostgresDocuments` keeps them as rows.
- **Media stay on the machine that made them.** Videos, previews, Clips, derived copies, caches (per-clip words, analysis, Render Plans, Media Words), models, and the files of Media Library items, Logos, Faces and Looks are not documents. They are large, and nothing else needs them to be anywhere but beside ffmpeg.
- **A Job names its Host.** Each machine has an id of its own (`DATA_DIR/machine.json`) and a name (`MACHINE_NAME`, or its host name). A Job records the Machine it was made on. On any other machine its documents are read and edited as usual, while anything that needs its directory (playing, thumbnails, exports, running a stage, rendering, stopping) is refused with 409 and the Host's name. Only the Host's Worker takes its unfinished Jobs back at start. Deleting it elsewhere removes its documents and leaves its media on the Host.
- **A change is one transaction.** Where a store read a file, changed it and wrote it back under a lock, it now does so inside a transaction holding a Postgres advisory lock named for the document (for a Job, its `job.json`), so the two machines never overwrite each other's change and a change that raises saves nothing. The process's own lock stays in front of it. Job listeners are told after the change is committed.
- **Secrets are sealed.** The saved settings (the LLM keys), the Agent Providers' keys and the YouTube cookies are rows of `secrets`, encrypted with `SECRETS_KEY` (Fernet; several keys, comma-separated, while one is being replaced). Every machine needs the same key; the database alone gives nobody the secrets. A backend with `DATABASE_URL` and no `SECRETS_KEY` doesn't start. A secret sealed with a key this machine hasn't got reads as none, with a warning, and the `.env` values apply. yt-dlp reads the cookies from each machine's own mode-600 copy.
- **Settings saved on one machine apply on the other** at its next request: the settings' version is compared, at most once every two seconds.
- **Existing accounts are imported once, by hand.** `make import-accounts` copies each `DATA_DIR/users/<account>/`'s documents and secrets into Postgres, with this machine as each Job's Host. It keeps what Postgres already has (so it can be run again), changes nothing in the directory but a mark, and never reads the unassigned root of 0032.
- **The schema is made at start**, by idempotent statements under an advisory lock. Two tables don't need a migration tool yet; `schema_version` is there for when they do.

## Amends

- **0032, "each account gets a private workspace":** with a database, the workspace directory holds the account's media and caches; its documents and secrets are in Postgres.
- **0032, "run a single backend worker process":** still one process per machine. Two machines may share a database, because a Job is run only by its Host.
- **0027, keys in `DATA_DIR/agent/credentials.json`:** with a database they are a sealed secret instead.
- **0003, re-reading for another process's edits:** the same periodic re-read now also catches the other machine's.

## Consequences

- Every store call is a round trip to the database. A Candidate save reads and writes its Revision History whole (a few hundred kB): if that is slow against the hosted database, the history becomes one row per entry.
- When the database can't be reached the API answers 503; nothing falls back to the files.
- A Job opened away from its Host has no video: the editors are of little use there. Moving media between machines is a separate decision (object storage).
- Media Library items, Logos, Faces and Looks are listed on every machine while their files are on one. A Candidate using one renders only where the file is.
- Unsetting `DATABASE_URL` after the import shows the files as they were then; the backend warns at each such account's first request.
- Losing `SECRETS_KEY` loses the saved keys and cookies, which are then entered again.
- Not built yet: a sweep of the media a Job deleted from another machine leaves behind, and change streams that ask a version before re-reading.
