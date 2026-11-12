# Nebula Skip for the Atari 8-bit

A line-drawn first person action adventure for the Atari 8-bit: portal rooms, stick-figure enemies, and a mode-E world. The playable disk is `nebula.atr`. Boot it in Altirra as a 130XE (`/hardware:130XE /memsize:128K`); it needs the extra 64K bank RAM and no longer runs on a 64K machine.

## Display

The 3D view is a **mode-E** window under a 9-row text HUD. The world is still projected at 192×128; the plotter keeps every other column, so 96 colour-clock pixels are drawn in the middle of each 32-byte row. It's double buffered by updating display lists. Lines are unrolled Bresenham bodies.

## World

The map is **rooms as axis-aligned hulls**, not a global mesh. Floor plans can be a box or a tetromino (**T / L / S**, including a proper S dogleg) a squared-off **C**, a three-row **Stair**, or a **Pit** (sunken area inside the floor plan). Collision is 8-bit tests against the room’s collider boxes. Closed doors are blocking planes; open doors are walk-throughs that switch the active room. Various keys (not the in game name) unlock matching doors. Only the current room is drawn — doorways do not punch a view into the next one.

Ramps use the AABB for **rise/run** (`height = slope_y + (local * sy) / run` in 8.8) so the eye rides the slope. Elevators, switches, and crates share the same box tests. Step off a ledge and you fall; a hard landing costs health.

Walk-over **things** grant ammo, health, armour, keys, and abilities. Message, DNA terminal, hurt, and elevator **triggers** are undrawn AABBs; a switch can arm a trigger that would otherwise stay inert. A switch or trigger can move to another map or return to the menu endings.

Off-screen **items** (AABB meshes) and **enemies** skip rotate/project/draw. Horizontal and vertical tests use a fat 45° cone (`|axis| ≤ z` plus a size pad) so the miss is drawing something a bit off-screen, not dropping something that is still in the 192×128 view. The active room’s bounding lines are not frustum-culled.

There’s an editor for maps (Unity-style orbit in the viewport), item meshes, and enemy animations.

Door and switch visuals are defined in the same editor as other items. They are treated a little differently when placed and rendered, but we shouldn't have a separate list for them.

The world is a set of maps that can arbitrarily be moved between. The state of the map should be saved when leaving it and restored when returning to it, in much the same way as the quicksave works.

## Entities

Enemies are definable in the editor, but then require a code and data module. Poses live in local space as signed offsets from the creature base. Animations are rotoscoped from sprites onto custom skeletons, or taken from stock animations and tweaked. A few KB of poses per type, plus one line layout. The enemies look like armatures in-game.

They run a room-scoped state machine (idle / patrol / alert / approach / attack / pain / death). A room holds at most two types.

Yaw is rolled(!) into the world rotation to avoid a double rotate. Perspective and rotation use 8-bit **log / antilog LUTs** (`alog(log|x| + log|cos θ|)`).

The pistol is the only weapon. The interesting options are abilities.

An explosion is a half-dome of pixels pre-simulated.

The pistol is stamped into the mode-E bitmap (body, muzzle, enemy muzzle, impact splat). Bob and recoil move that stamp.

SFX are PC-speaker envelopes on POKEY channels (player / enemy / world).

## Build

6502 (ACME) plus Python table generators. Copy `setup-env.example.bat` to `setup-env.bat` and point `ACME` at your install. Python 3 needs Pillow (`python -m pip install pillow`). The generators pack the UI font, pistol, muzzle, and splat PNGs. The editor does not use Pillow.

```bat
build-a8.bat       :: generate listings, assemble PRGs, write dooma8.atr
make.bat           :: build-a8.bat, then boot dooma8.atr in Altirra
run-game.bat       :: boot dooma8.atr in Altirra
run-editor.bat     :: local map / skeleton / item editor
```

Controls: joystick to move and fire. Button 2 strafes. Enable an ST mouse in Options to turn and shoot.
We'll also try pressing and holding fire to strafe, since it's most useful in a combat situation. If that works, an autorepeat firing mechanism should be removed.