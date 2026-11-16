# Editor notes

## Delivery — no server

* The editor is a **single bundled HTML file** (`editor/index.html`). `run-editor.bat` runs `bundle_editor.py` and opens that file in the browser (`file://`). **Do not add a local HTTP server** — not in the batch file, not in docs, not as a workaround.
* All JS/CSS is inlined at bundle time. Source modules live under `editor/js/`; edit those and rebundle.
* Project data is `editor/nebula.json` (items and version). Levels live in `editor/maps/map<a-z>.json`. The browser stores file/folder handles in IndexedDB after you pick them once; refresh may need **Allow** on the map file gate to reload bindings and autosave.

## Names
* Maps are **MAPA, MAPB, …** (up to MAPZ) and that key is the real identity (tabs, save file, game export, disk file name). The Levels grid has a **+** after the last map that adds the next letter; the game plays them in letter order and stops at the first map with no spawn.
* The editor can still give each map a **display name** (e.g. "Slipgate Complex") shown in the UI next to the key.
* Rooms can have display names too. Names are for authors; the game addresses rooms by index.

## Object tree
* The Objects panel is a **shallow collapsible tree**: each **room** is a parent, the objects that sit in that room are its children.
* Same grouping the game uses: a room owns its crates, elevators, switches, triggers, keys, enemies, spawn, things. **Doors appear under every room they overlap.**
* Flat object lists are an authoring hazard; don't flatten for the game binary either.
* List labels are **type only** (e.g. "Crate", "Trigger") — no XYZ in the name. Rooms may show their display name.
* Non-room labels that would wrap stay on **one line** and elide with an ellipsis (`…`). Room names may wrap.

## Tags (editor) → indices (game)
* Shared **tag** strings in the editor link controllers to targets (switch ↔ elevator, switch ↔ trigger arm, trigger ↔ elevator, door ↔ key).
* Export resolves tags to **indices**. The 6502 side never stores or compares tag strings.

## Locked doors
* A door can be marked **locked** and given a **key** requirement (same tag/index idea: named key in the editor, key index in the game).
* Place **key** pickups in the tree like other room objects. Until the player holds that key, the door stays a blocking plane.

## Triggers
* One placeable **trigger** volume (undrawn AABB; editor shows it dashed / ghosted).
* Inspector has a **purpose** dropdown, then fields that depend on it. Purposes:
  * **Display message** — one-line HUD text while the player is inside (text field; no tag).
  * **Board ship** — same HUD text as a message; while inside, fire opens the nebula chart (travel between maps; node positions in `ship_map.csv`). Reachable: current map, the accepted bounty's map, and maps already visited. Text field; no tag.
  * **DNA terminal** — same HUD text as a message; while inside, fire opens the DNA terminal (shop / bounties, from `shop.csv` and `bounties.csv`) instead of shooting (text field; no tag).
  * **End of level** — fires once on entry; no HUD. Level transitions come later.
  * **Hurt player** — 10% health on enter, then every 2 seconds while inside (no tag).
  * **Activate elevator** — destination **tag** targets an elevator; toggles to the other stop on entry if that elevator is idle.
  * **Summon elevator** — destination **tag** targets an elevator; on entry, if idle, sends it to the stop nearer the player’s feet (no-op if already there or moving).
  * **Spawn tagged enemies (once)** — **tag** matches enemies with the same **Tag** (enemy inspector). Tagged enemies start hidden/inactive; entry wakes them and the trigger latches spent (same latch as stair elevators; an **Armed by** switch re-arms it).
* Optional **Armed by** tag: if set, the volume does nothing until a switch with that tag is used. One switch can arm every trigger that shares the tag. Destination **tag** (elevator / unlock) is independent.

## Bounties
* Enemies have an optional **Bounty name** (printable ASCII, 20 chars) and **Bounty (bits)**. 0 = not a bounty. The editor snaps the value to 4n-1 (3, 7, 11 ... 1019); the cooker stores the one byte n (`en_bty`) and the name as an offset into the map text blob (`en_bnm`, same 255-byte offset limit as trigger texts; names are appended after the trigger texts; an empty name cooks as "unknown").
* With the DNA rig (shop item, adds the **scan** gear), standing within a few cells of a dead bounty enemy shows "press fire to scan". Fire opens the green DNA rig screen: name, 1-3 random crimes from `crimes.txt` (on the "crimes:" line, wrapping to a second), the bounty, "status: deceased", an upload bar, then the bounty is paid in bits. Each corpse pays once (saved in the quicksave).

## Ambient tune
* The map inspector (Maps tab, nothing selected) has a **Tune** list and a **Play** button. The list is the library in `tools/genambient.py` (generated into `editor/js/tunesData.js`, so rerun the build or `python tools/genambient.py` and rebundle after adding a tune). The pick is saved as `"tune"` in the map JSON; none = silence.
* Each tune carries its own voicing (swell, release, delayed vibrato, pitch glide, hold level through rests) set next to its score in `tools/genambient.py`; the editor only picks the tune.
* Play renders the tune exactly as the game steps it (same per-VBI state machine as `src/ambient.asm`, `editor/js/tunePlayer.js`) through a simple POKEY square / poly4 model, looped. Changing the pick while it plays swaps the tune.
* The game cooker packs the picked tune into the map (not counted against the 4096-byte map cap; shown as `tune N` in the map load title). An unknown name fails the build.

## Patrol
* Enemies have a **Patrol** checkbox. When set, an idle enemy picks a random cardinal, walks at least 6 units if that ray is clear of walls, then idles 1–2 seconds and repeats. Failed rays stay idle and retry next frame.
* There are no placeable patrol-point markers.

## Cutscenes
* The **Cutscene** tab edits one cutscene per map (`map.cutscene` in `maps/map<x>.json`), played when you arrive on that map, before the "docking at" card. After `duration` seconds the game drops into the spawn room.
* The cutscene happens in an ordinary **room set aside** in the Maps tab (pick it in the tab's Room list; make it big, leave it without doorways, give it a background colour). It must not be the spawn room.
* **Actors** are not map objects: they live in the cutscene block, so they never count against the thing/room limits. Max 6 actors, exactly one **camera**, items are any placeable item (first example: a planet, a ship, a camera).
* An actor with no path is stationary. A path of 2-16 points is a **Catmull-Rom spline** through the points, travelled over the whole duration at constant speed, or with a **Speed** ease (slow at end, slow at start, slow at both ends; baked into the samples, no engine change). The **Starfield** toggle adds a fixed pseudo-random scatter of 128 stars behind the room (xorshift16; clumped in places; mostly 1-pixel dots, some vertical 2-pixel pairs and small plus shapes, since the room only has ink and red as visible tones; the overlay plots those within about ±32 yaw ticks of the camera; spec in the header of `cutsceneModel.js`). The **Hide room** toggle drops the room box: the game skips its vertex transform and stroke (the room still supplies the background colours, and its crates, doors and switches still draw). Items and the camera each have a yaw slider (0-255, 256 = full turn; shown when facing is **fixed**), items also a Scale slider (1x 2x 4x 8x, as for placed items). Items face **fixed** (their yaw) or **along path**. The camera faces **fixed**, **along path**, or **face item** (another actor, horizontal only: the game projector has no pitch). Camera x/y/z is the eye position.
* Cutscene items never spin: the baked yaw is their facing, whatever the item's **Rotating** flag says.
* Coordinates are whole units 0..255 like everything else. The editor bakes the cutscene to samples every 128 ms (`CUT_STEP_MS`, `bakeCutscene` in `cutsceneModel.js`); the game cooker (`tools/gencutscene.py`) implements the same spec, and the Preview panel plays the baked samples exactly as the game lerps them. `node tools/cut_bake_js.js editor/maps/mapa.json` dumps the editor's bake for cross-checking the cooker.
