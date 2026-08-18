# Standalone save integration

## Historical Live Editor investigation

- The Live Editor route was investigated during development but is not part of Career Lens.
- The release has no injector, Lua runtime, Live Editor binary, or FIFA process-access dependency.
- All player data now comes from the selected career save.

## Why Career Lens does not embed it

The FIFA 22 DLL that implements the database API and Lua engine is distributed as a compiled binary. The public FIFA 22 repository contains the release package and documentation, but not the DLL implementation. The DLL exposes its Lua engine through the in-game overlay; it has no documented command-line, named-pipe, socket, or other IPC endpoint for external script execution.

Running a Lua file from Career Lens would therefore require one of the following:

1. injecting a second component into FIFA;
2. writing to FIFA/Live Editor memory and starting a remote thread; or
3. automating keyboard and overlay input.

All three conflict with Career Lens's read-only process boundary and are unnecessary now that save decoding is implemented.

## Safe independent route

The standalone design replaces the exporter rather than embedding it. Career Lens now parses a temporary copy of the selected career itself, resolves names and teams, and reconstructs the saved scouting visibility state without attaching to FIFA.

The **Refresh data** button decodes only the selected save. There is no Live Editor fallback, Lua execution, process attachment, or requirement to load the career inside FIFA.

## Offline database probe

The current FIFA 22 save was successfully inspected through a temporary read-only copy. Its 16,034,632-byte container exposes three intact database blocks (570,232 bytes, 8,212,916 bytes, and 1,094,012 bytes), and their table directories and record counts validate. A standalone reader is therefore feasible without decrypting or decompressing the whole save. The main remaining work is a schema-driven decoder for bit-packed table rows, localization/generated-name resolution, and faithful reconstruction of shortlist, scouting progress, and attribute visibility.

## Offline decoder

Career Lens now contains a bounds-checked, read-only decoder for the embedded database format. It parses table headers and field definitions, decodes LSB-first bit-packed integers (including FIFA metadata range offsets), strings, and 32-bit real fields, and has no packing or save-writing API.

Validation against `Career20260818060238` currently confirms:

- 19,697 player rows and 20,483 player-team links decode successfully;
- player 237179 (Cherif Ndiaye) resolves to team 115486;
- overall, ball control, dribbling, finishing, acceleration, and sprint speed decode as 74, 78, 69, 77, 74, and 79, exactly matching the in-game report;
- the created-club database token `*TeamName_Abbr15_115486` can be replaced with the save-header label `Frens FC`.

The decoder is now the primary frontend data source. Bundled FIFA 22 name caches resolve stock player and club IDs, while save tables supply edited/generated names and created-club labels. A bounded parser locates the career's reveal records, saved RNG seed, scouting flags, and progress. The resulting ranges were regression-tested against the in-game reports for Gonçalo Ramos, Arianit Ferati, and Agustín Martegani. Players without saved knowledge records remain unknown, and exact overall/value/wage fields remain hidden outside the user's squad.

The implementation intentionally has no serializer or save-writing path. Every refresh reads a uniquely named temporary copy and deletes only that copy afterward.

## Player portraits

The portraits shown by FIFA are legacy assets stored inside Oodle-compressed Frostbite archives under `data/ui/external/ion_fut/imgAssets/portraits`. Stock-player portraits are feasible: a future read-only archive indexer can locate them by player/head asset ID and cache decoded DDS images locally. This is a medium-sized follow-up because the current career decoder does not yet parse Frostbite TOC/CAS indexes or DDS textures.

Generated youth and created-player portraits are a separate limitation. Their faces are rendered by the game rather than stored as ordinary portrait files; Live Editor's own scripts queue the game to generate those minifaces. A completely standalone Career Lens can therefore support stock portraits reliably, but generated-player portraits would require either a generic silhouette or a separate rendering system. Scraping a website is not a dependable substitute because it cannot match career-generated or edited players.
