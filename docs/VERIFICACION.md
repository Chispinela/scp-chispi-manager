# Verification and test limits

This document separates historical execution evidence from current source checks and untested scenarios. Historical results below were recorded during development on **2026-10-20**; they are not a claim that the current game release was reinstalled or revalidated today. Generated evidence in `output/` and installed profiles in `runtime/` are intentionally excluded from the repository.

## Version 1.0.5: stalled folder preparation

A received Windows 11 build 26100 diagnostic showed accepted EULA, a pending `createDirectories` stage for at least 40.9 seconds, no SteamCMD startup, and no saved profile. It did not identify a permission denial, driver, antivirus, or corporate policy as the cause. The original report and its personal data are not published.

The revised implementation prepares directories and initial files in a separate helper, uses non-recursive filesystem steps, records paths/operations/durations, and terminates preparation after a 30-second deadline. The parent commits the profile only after helper success and exit. Failures restore the wizard controls and offer another local folder without deleting existing servers or partial files.

Historical automated verification passed 15 tests, including termination of a genuinely blocked helper event loop, subsequent successful creation, filesystem error paths, and rollback after profile-save failure. A real Electron UI test, also run against the packaged executable, checked:

- A 15-second warning and ZIP export while creation was pending.
- Termination at the 30-second deadline and restored controls.
- No partially saved profile.
- Preserved EULA selection and creation of exactly one profile in the alternative directory.
- Detailed filesystem operations in the exported report.

This is a controlled reproduction of the symptom. A successful retest on the original remote machine remains unconfirmed.

## Earlier development checks

### Version 1.0.4

Fourteen data tests covered persistent rotating logs, credential redaction, ZIP export, pending-operation metadata, fallback logging, and rollback of failed profile creation. UI tests injected a failed write and a 20-second wait, verified visible errors and export during the wait, and verified renderer-error persistence across restarts. The packaged build also started/stopped a real local game server and retained its console output.

### Version 1.0.3

Real modern, legacy, and fallback console execution was checked on Windows 11 x64 `10.0.26200`. Windows version-selection logic was tested across older Windows 10 and several Windows 11 build numbers. This does not replace execution on each OS. See [Windows compatibility](COMPATIBILIDAD-WINDOWS.md).

### Version 1.0.2

Test-only directories verified cancellation, profile-only removal with files retained, and actual movement of only the selected server directory to the Recycle Bin. Shared SteamCMD and other profiles remained intact. Data tests covered active operations, unsafe roots, junctions, and recycling errors. Confirmation text was checked in all six languages.

### Version 1.0.1

A new dedicated-server installation ran through official SteamCMD from the real interface. Download percentages included 4%, 16.3%, 32.2%, and 78.6%, followed by verification. Completed/remaining phase percentages and live terminal output remained visible across tabs. These were actual SteamCMD reports rather than timed simulation.

## Historical live-server evidence

- Official SteamCMD installed dedicated-server App 996560, BuildID 25890254. At the time it reported SCP:SL 14.2.8 and LocalAdmin 2.5.16.
- Two actual game processes ran simultaneously on UDP 7777 and 7778, bound to localhost for testing.
- Both reached **Waiting for players**, returned **List of players (0)**, stopped with exit code 0, released their ports, and produced backup ZIPs.
- The packaged app displayed its splash/logo, more than 100 configuration controls, original Remote Admin roles, real startup, player queries, a `hello` command, and graceful stop.
- UI checks covered the wizard, tabs, persisted `max_players` changes, backups, invalid Steam-key errors, and six languages.
- Data checks covered comments/lists, role assignment, duplicate ports, persistence, full backup restoration, external-change detection, and restricted paths.
- A production dependency audit reported no known vulnerabilities at that historical checkpoint; this is not a current audit guarantee.

## Still unverified

- A real client joining from another computer through LAN, public Internet, or Radmin VPN.
- Real connected-player lists beyond the confirmed zero-player response.
- An authenticated VAC API response using a user's Steam API key.
- Physical execution on Windows 10 and every Windows 11 release.
- Completing the interactive NSIS installation on every target system; the generated unpacked executable was exercised directly.
- Resolution of the original remote computer's filesystem stall.

## Reproduce tests

Run normal source checks on Windows x64 with dependencies installed:

```powershell
npm test
npm run test:ui
npm run test:diagnostics
npm run test:folder-recovery
```

The interface tests open real Electron windows and write disposable fixtures under `output/`. The folder recovery test intentionally blocks a helper and takes over 30 seconds. After packaging, add `--packaged` to the diagnostic/recovery scripts to exercise the built executable.

Additional tests have prerequisites and effects:

| Script | Requirements and effects |
| --- | --- |
| `tests/delete-ui.cjs` | Creates test profiles and exercises the real Windows Recycle Bin. |
| `tests/install-ui.cjs` | Uses existing runtime profiles; `--fresh` creates a new test installation and can download substantial game data. |
| `tests/packaged-ui.cjs` | Requires built binaries and installed `runtime/` profiles; starts/stops a real server and sends a console command. |
| `tests/live-server.cjs` | Requires an installed first runtime profile; changes its bind configuration to localhost, starts/stops it, and writes logs. |
| `tests/multi-server.cjs` | Requires an installed first profile; creates/prepares a second profile, adjusts configurations, starts/stops both, and makes backups. |
| `tests/windows-runtime.cjs` | Electron entry point for real terminal backend tests. |
| `tests/windows-package.cjs` | Requires the packaged executable; checks the compatibility panel and real terminal backends. |
| `tests/make-icon.cjs` | Electron utility that regenerates `assets/icon.ico` from the logo. |

Read a script before running it against existing profiles. No installed test servers, diagnostic ZIPs, local transcripts, or private state are distributed with source.
