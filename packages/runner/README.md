# Pico execution runner

`@pico/runner` executes trusted local Python/uv experiments. It owns execution
directories, immutable snapshots, process supervision, logs and observations.
It does not import the laboratory, model SDKs or scientific persistence.

The laboratory owns datasets, workspaces, `run-records` and scientific records.
It supplies authorized source directories and manifests to `submit(request,
sources)`. Source paths and explicit environment bindings are transient: they
are not added to preserved execution requests or snapshots.

## Lifecycle

`createRunner(options)` is synchronous and has no filesystem/process effects.
`start()` acquires exclusive coordination of the canonical data directory and
inspects existing attempts **without dispatching**. Connect `onUpdate` before
starting, reconcile scientific links, then call `resumeDispatch()`.

`pauseDispatch()` stops admission by the scheduler, suspends periodic
reconciliation and drains accepted publications. Manual `reconcile()` and
`inventory()` remain available. A backup coordinator must separately block new
application mutations, pause the runner, reconcile and require
`inventory().safeToBackup`. This package does not back up scientific SQLite.

`close()` drains accepted operations and releases the coordinator lock. Already
submitted supervisors survive it. Call `cancel()` explicitly to stop a run.
Repeated `start()` and `close()` calls share their respective promises.

## Files and authority

- `runner.ts`: public API, lifecycle, admission and observation delivery.
- `snapshots.ts` and `format-v1.ts`: publication, reproduction and historical
  serialization/hash compatibility.
- `execution-files.ts` and `files.ts`: operational records and bounded safe IO.
- `queue.ts` and `coordinator-lock.ts`: capacity and exclusive scheduling.
- `processes.ts`, `worker.ts`, `watchdog.ts`, `recovery.ts`: identities,
  handshake, lifetime supervision and conservative recovery.
- `outputs.ts` and `archives.ts`: measured observations and byte-verified export.

The public `fileAccess` operations are safe byte/file primitives. They do not
register datasets or attach scientific meaning to files. The v1 manifest codec
preserves historical provenance fields without importing scientific types.

The supervisor owns a pipe to a watchdog that leads the experimental process
group. Python/uv starts only after durable identity and `READY → GO`. EOF,
cancel or timeout makes the watchdog terminate its own group. A terminal record
is published only after the group is gone. The runner never signals a PID merely
because that number appears in an old claim.

This protects against loss of the supervisor while the application is offline.
It does **not** contain hostile code that escapes the group or guarantee cleanup
after isolated death of the watchdog itself. Ambiguous identities/groups keep
capacity occupied and block new dispatch and backup. Tests demonstrate this
limitation explicitly. The local backend requires Bun, Python and POSIX process
groups/`ps` (macOS or Linux); uv is needed for uv experiments.

Legacy `interrupted` records with an old PID-only claim also remain unknown:
that status did not prove that experimental descendants had stopped. Their
records are preserved, but backup and archive export require verified termination.

`executionControlFiles` lists disposable authority sidecars. Backups/restores
must not restore those files or `.pico-runner-owner.sqlite*` as authority to
control old processes. Archives contain terminal attempts and never execute on
import. The lab's restore path rejects active/inconsistent historical backups.

## Verification

`bun test packages/runner/tests` runs real Python/uv, crash, timeout, cancellation,
restart, ownership, archive and v1 compatibility scenarios. No external model
or service is needed. The frozen historical fixture was written by the original
implementation, before the package extraction.
