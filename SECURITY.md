# Read-only safety boundary

Career Lens is a local analysis application. Its player-data boundary is intentionally narrow:

1. Save discovery only enumerates names, sizes, and modification times for `Career*` files in FIFA 22's settings directory.
2. Offline inspection accepts a discovered path or a path explicitly chosen in the native file picker, and rejects files whose names do not begin with `Career`.
3. The original save is opened with read permission only. Career Lens never requests write permission for it.
4. Inspection creates a uniquely named working copy in Career Lens's temporary directory, verifies the source did not change during copying, and parses only the copy.
5. Temporary cleanup targets only the exact generated copy inside `career-lens-readonly`; it can never point at the original save.
6. Career Lens never attaches to FIFA, injects a DLL, reads or writes process memory, sends game input, or invokes Live Editor.
7. Career Lens does not require administrator access.
8. The frontend has no general filesystem, shell, memory, or process API. It can call only narrow native commands.
9. The native layer reconstructs saved scouting visibility before returning player data; own-squad ratings may be exact, known reports are ranged, and unavailable ratings are blank.
10. No snapshot, history, or background monitoring is performed.
