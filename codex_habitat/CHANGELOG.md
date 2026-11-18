# Changelog

## Unreleased

## 1.4.2

- Codex CLI 0.169.0 → [0.170.0](https://github.com/openai/codex/releases/tag/rust-v0.170.0).

## 1.4.1

- Codex CLI 0.167.2 → [0.169.0](https://github.com/openai/codex/releases/tag/rust-v0.169.0).

## 1.4.0

- Added generic read-only diagnostics for selected states, bounded history, loaded automation configuration, and stored automation/script traces.
- History requires explicit timezone-aware timestamps, at most 24 hours, and 1–20 selected entities; invalid dates and injected inputs are rejected before requests.
- Added generic cover/input-number state reads, position/range attributes and change timestamps, plus native input-number reloads.
- Added isolated diagnostics tests and retained private-inbox exclusions and household-identifier regression checks.

## 1.3.0

- Added generic dashboard fetch/save commands using native Lovelace APIs, with baseline conflict checks, private pre-save backups, and readback verification.
- Refuse working files inside active `.storage`, including symlink targets; dashboard reads never overwrite existing files.
- Excluded the private local update inbox from Git and Docker contexts and added regression checks. Household-specific policy code remains excluded.

## 1.2.0

- Added allowlisted entity-state reads, media-device and area inspection, and verified device-area assignment.
- Added local Bluetooth scan-mode inspection and verified changes through native Home Assistant options flows.
- Added custom-template reloads.
- Bundled generic helper scripts in the image and added isolated transport tests.
- Removed installation-specific policy diagnostics and entity identifiers from the current source; helper inputs are caller-supplied or discovered from Home Assistant registries.

## 1.1.0

- Enabled hosted Context7 documentation by default with anonymous access, an optional masked API-key setting, and an opt-out switch.

- Added default Codex guidance to inspect existing automations first, prefer native Home Assistant functionality, and avoid unnecessary custom integrations.

## 1.0.0

- First Codex Habitat release: a persistent Codex workspace in the Home Assistant sidebar, with device-code or API-key sign-in.
- Configuration editing, model and reasoning-effort selection, and optional helper-based Home Assistant checks, reloads, and validated restarts.
- Fixed the initial terminal history limit and dark/light theme colors.
- Added readable Configuration labels, one user guide, and concise release notes that do not repeat pending changes.

Control settings are helper preferences, not security boundaries for code inside the container. Back up Home Assistant and review changes before approving them.
