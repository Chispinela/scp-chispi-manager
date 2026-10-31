# Diagnostics and troubleshooting

Persistent application diagnostics were introduced in 1.0.4. Version 1.0.5 adds isolated folder preparation and recovery from a stalled filesystem call.

## Collect a report

1. Use version 1.0.5 or later and reproduce the problem.
2. In the server wizard, read and accept the EULA only if you agree, then select Create server.
3. Watch the current stage. A warning appears after 15 seconds; avoid starting duplicate creations.
4. Select **Export diagnostics** inside the wizard, sidebar, or application settings and save the ZIP.
5. Review the report before sharing it. If the whole window stops responding, restart the app and export the retained logs. If startup fails, the error dialog shows the log directory.

Logs cannot reconstruct failures from versions before logging was added. Collecting a report does not require a Steam login or API key.

## Folder creation recovery

In 1.0.5, a separate helper prepares server folders and initial files. If it exceeds 30 seconds, the app stops waiting, reports the failure, and restores the controls. **Use alternative local folder** proposes a location under `%LOCALAPPDATA%`; inspect it before continuing. You can also go back and choose another folder.

The name, port, and EULA selection are preserved. A profile is saved only after successful helper completion and exit. Partial folders from failures are retained to avoid deleting user files automatically. A reported AMD/Windows 11 stall was localized to folder creation under Documents; its underlying OS cause remains unconfirmed.

## ZIP contents

- `summary.json`: application version, Windows build, architecture, CPU, memory, component versions, GPU information/features, basic server metadata, and pending operations with elapsed time.
- `logs/application.jsonl` and up to four rotated files: startup/shutdown, errors/codes/paths, filesystem operations, wizard stages, operation durations, slow-operation warnings, renderer/helper/GPU failures, JavaScript errors, and recent SteamCMD/server output.
- `LEEME.txt`: a description of the report contents. The filename is retained for compatibility; its contents are in English.

Console commands beginning with `>` are excluded from persistent application logs. Reports do not attach `manager.json`, configuration files, backups, or the stored Steam API key. Known credentials and credential patterns are redacted. Nothing is uploaded automatically.

Paths can contain Windows user names. Server output can contain IP addresses and player identifiers. Review those details before posting an export publicly; redaction does not make a diagnostic anonymous.

## Location and retention

Default logs: `%APPDATA%\SCP Chispi Manager\logs`. With `--data-dir`, logs live in that directory's `logs` subfolder. **Open log folder** in application settings opens the actual location.

The manager retains five files of approximately 2 MiB each. If opening the primary location fails, it tries `%TEMP%\SCP-Chispi-Manager-logs`; the summary records the chosen path and logging errors.

Logs do not depend on the renderer remaining open. OS termination or disk failure can still lose recent lines. A complete main-process hang can prevent export until restart. Reports include only the retained recent history, not an unlimited archive.

## Include with an issue

Describe the application version, Windows version/build, selected operation, reproduction steps, and whether choosing a different folder changes the result. Attach a reviewed diagnostic if useful. Do not include API keys, server backups, private configurations, or unreviewed logs in a public issue.
