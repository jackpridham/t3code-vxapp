# T3 Deploy Outage Remediation

Date: 2026-04-08

## Findings

- The outage was not caused by SSH, base networking, or `ExecStart` failing to launch Node.
- `t3code.service` had a systemd drop-in that ran Jasper autoresume as `ExecStartPost`.
- The autoresume helper used `vxl-t3 doctor --json` as its health gate.
- That doctor path depended on heavyweight T3 health behavior rather than a cheap startup-safe readiness signal.
- On the live host, T3 startup routinely takes tens of seconds because the orchestration state is large and startup work is expensive.
- Because autoresume ran inside `ExecStartPost`, any slow or heavy post-start validation could hold unit startup open long enough to fail the service or make deploy behavior unreliable.
- `deploy.sh` also had two operational weaknesses:
  - it treated transient HTTP reachability as the success signal
  - it used `systemctl restart --no-block`, which let deploy race against the old process and transitional systemd states

## Root Cause

The underlying issue was a bad startup contract:

- heavy recovery/health work was coupled to service startup
- the health path used for that recovery was not lightweight
- deploy verification was not aligned with the real lifecycle of the service

In short, T3 startup and Jasper autoresume were too tightly coupled. That made a slow but recoverable startup look like a failed deploy and could drag the main service down with the helper.

## Remediation

### T3 repo

- Added lightweight HTTP health endpoints:
  - `/health/live`
  - `/health/ready`
- Exposed cheap in-process readiness state from the server readiness coordinator.
- Updated deploy verification to:
  - wait on `/health/ready`
  - restart systemd synchronously
  - verify final unit state after restart
  - use a larger readiness timeout budget to match the observed host startup profile

### vortex-scripts / host

- Reworked the Jasper autoresume helper to poll `/health/ready` instead of the heavy doctor path.
- Replaced the blocking `ExecStartPost` model with a separate companion unit:
  - `t3code.service` starts T3
  - `t3code-autoresume.service` runs autoresume independently after T3 starts
- This preserves autoresume behavior without allowing it to fail or block the main T3 service.

## Verification

- `bun fmt` passed
- `bun lint` passed
- `bun typecheck` passed
- targeted server test for health endpoints passed
- live host verification:
  - `t3code.service` => `active/running`, `Result=success`
  - `t3code-autoresume.service` => completed successfully
  - `/health/live` => `ok`
  - `/health/ready` => `ready`

## Outcome

The original outage mechanism has been removed:

- T3 no longer depends on Jasper autoresume finishing during service startup
- deploy no longer reports success or failure based on the wrong runtime phase
- the health signal used during startup is now lightweight and appropriate for operational use

The host is still slow to fully boot T3 because the live dataset is large, but that condition is now handled safely instead of taking the service down.
