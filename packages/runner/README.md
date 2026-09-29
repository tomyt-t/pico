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
groups. Linux identities use readable procfs (boot ID and process start ticks);
macOS uses `ps`. Missing identity information fails closed. uv is needed for uv experiments.

Legacy `interrupted` records with an old PID-only claim also remain unknown:
that status did not prove that experimental descendants had stopped. Their
records are preserved, but backup and archive export require verified termination.

`executionControlFiles` lists disposable authority sidecars. Backups/restores
must not restore those files or `.pico-runner-owner.sqlite*` as authority to
control old processes. Archives contain terminal attempts and never execute on
import. The lab's restore path rejects active/inconsistent historical backups.

## Operational recovery

`inventory()` includes `issues` for unreadable execution records, snapshot
manifests or failed scientific observation delivery, and `recoveredPublications` for staging directories preserved under
`labs/<lab>/run-recovery`. Corruption keeps dispatch and backup blocked while
the application remains available for diagnosis. Startup moves an orphaned
`.pending-*` directory only under the coordinator lock and only when it contains
no process-control evidence; a receipt records its origin and metadata hashes.
These preserved directories belong in research backups.

`repairExecution(labId, runId)` rechecks the existing attempt. It can reconstruct
a damaged record from an intact snapshot or resolve a dispatch whose supervisor
is proven gone. The original record is retained and the outcome is interrupted,
never invented success. Incomplete claims, a missing supervisor identity on an
admitted run, or a living/uncertain process group remain blocked. This action is
not an operator override of termination evidence.

Disposable `work/` directories (including virtual environments) are removed
automatically after terminal observation and independent lifetime verification;
`cleanupWorkOnCompletion: false` retains them. `cleanupWork(labId, runId)` offers
the same checked cleanup explicitly. Snapshots, outputs and logs remain intact.
Cancellation, timeout and supervisor loss send SIGTERM, allow a short 200 ms
flush interval, then SIGKILL; an independent 350 ms bound applies even if IO stalls.

## Input sizes and local resources

`fileAccess.hashFile`, `listFiles` and `copyVerified` stream file hashes in 1 MiB
chunks. Verified copies use CoW cloning when available and never hard links.
`datasetLimits` configures snapshot input limits independently of code/output
limits. Pico local directory imports use `fileAccess.LOCAL_DATASET_LIMITS`
(1 GiB per file, 16 GiB total, 2,000 files); small JSON uploads retain the
8 MiB per-file / 128 MiB total limits. The v1 JSON run archive also retains its
small-file limits: use the streamed research backup for larger datasets.

`environmentBindings` may be a resolver called with each preserved `RunRequest`;
resolved environment values remain transient. Resolution failure produces a
failed attempt before any supervisor is reserved and does not include secret
exception text in the record.

Optional request `resources` are preserved in the snapshot. On Linux,
`memoryMiB` sets RLIMIT_AS for each process and inherited children, not an
aggregate RSS/cgroup limit. `gpuDevices` selects numeric CUDA devices through
CUDA_VISIBLE_DEVICES; an empty array hides CUDA devices. It neither allocates
hardware nor guarantees device availability, isolation or GPU memory limits.
Unsupported host settings are rejected before publication; reading/recovering
historical records does not require their execution platform.
`localRunnerCapabilities()` discloses these platform limits and `sandbox: false`.

## Verification

`bun test packages/runner/tests` runs real Python/uv, crash, timeout, cancellation,
restart, ownership, archive and v1 compatibility scenarios. No external model
or service is needed. The frozen historical fixture was written by the original
implementation, before the package extraction.
