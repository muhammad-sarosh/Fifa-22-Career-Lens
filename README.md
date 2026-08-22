# Career Lens

Career Lens is a read-only player database and comparison app for FIFA 22 Manager Career Mode. It reads a selected career save directly, respects the information currently available to your manager, and helps compare players without modifying the save.

## Highlights

- Reads FIFA 22 Career saves directly and keeps the original file untouched.
- Finds players from your squad, youth academy, shortlist, scouting assignments, player searches, and the wider database.
- Preserves FIFA's exact, ranged, and unknown scouting information instead of revealing hidden ratings.
- Shows FIFA's familiar physical, mental, technical, and goalkeeping attribute layout and colour bands.
- Compares many players in matrix, profile, or ranking views with clear best/worst highlighting.
- Includes focus mode, highlighted rows, synchronized profile scrolling, and quick ranking cut-offs.
- Shows score, overall, age, value, and wage in ranking view.
- Provides editable 0–10 position presets, role variants, saved presets, temporary overrides, and custom presets.
- Exports the current matrix or ranking as Markdown text or a `.md` file.
- Supports neutral, buying, and selling value comparison modes.
- Detects the career's dollar, euro, or sterling setting for values and wages.
- Supports multi-position filters, keyboard navigation, select-all actions, and accent-insensitive search.

## Installation

1. Download `Career Lens_1.1.0_x64-setup.exe` from the latest GitHub release.
2. Run the installer, choose a destination folder, and optionally create a desktop shortcut.
3. Leave **Open Career Lens** selected on the final screen, or launch it later from the installed executable or shortcut.

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
