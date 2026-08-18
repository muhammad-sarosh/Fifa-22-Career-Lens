# Career Lens

Career Lens is a read-only player database and comparison app for FIFA 22 Manager Career Mode. It reads a selected career save directly, respects the information currently available to your manager, and helps compare players without modifying the save.

## Highlights

- Reads FIFA 22 Career saves directly and keeps the original file untouched.
- Finds players from your squad, shortlist, scouting assignments, player searches, and the wider database.
- Preserves FIFA's exact, ranged, and unknown scouting information instead of revealing hidden ratings.
- Shows every technical, movement, power, mental, defending, and goalkeeping attribute.
- Compares many players at once with per-row best/worst highlighting and click-to-focus rows.
- Includes a ranking view ordered by the selected position and role score.
- Provides editable 0–10 position presets, role variants, saved presets, and temporary overrides.
- Supports neutral, buying, and selling value comparison modes.
- Searches naturally across player names, clubs, and positions, such as `frens ndiaye`.

> Market-value estimates are not completely accurate yet and will be refined in a future release.

## Installation

1. Download `Career Lens_1.0.0_x64-setup.exe` from the latest GitHub release.
2. Run the installer, choose a destination folder, and optionally create a desktop shortcut.

## Using Career Lens

1. Save your career in FIFA 22.
2. Open Career Lens and choose **Select save**.
3. Select the relevant Career file from your FIFA 22 settings folder.
4. Browse or filter the player database, select players, and open **Compare**.
5. Choose **All attributes** for a general comparison, or select a position and role for weighted scoring and ranking.

You can keep FIFA open while using Career Lens. The app copies the selected save into its own temporary working directory, verifies that the source did not change during the copy, and only decodes that copy.

## Privacy and safety

- No save editing or repacking.
- No process injection, process writes, or input automation.
- No FIFA Live Editor dependency.
- No network connection is required to inspect a save.
- Hidden ratings are never inferred or exposed.

See [SECURITY.md](SECURITY.md) for the enforced read-only boundary.

## Development

Requirements:

- Node.js 20 or newer
- Rust stable with the MSVC Windows target
- Windows WebView2

```powershell
npm install
npm run dev
npm test
npm run tauri:build
```

Release outputs:

- Portable app: `src-tauri/target/release/career-lens.exe`
- Installer: `src-tauri/target/release/bundle/nsis/Career Lens_<version>_x64-setup.exe`

## Technology

Career Lens uses React, TypeScript, Vite, Rust, and Tauri 2.
