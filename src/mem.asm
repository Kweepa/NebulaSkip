; Atari 130XE play map (128K).
; GAME is four code segments, none inside the $4000-$7FFF bank window:
;   A $0900-$3FFF, B $8000-$B9FF, C $C000-$CFFF, D $E000-$EFFF.
; Bitmap A $4000 and bitmap B $5000 are main RAM under the window. ANTIC
; reads main RAM (PORTB bit 5 stays 1), the CPU sees bank 0 there during
; play (PORTB_PLAY) and main RAM only inside screen leaves (PORTB_MAIN).
; Bank 0: [DYN_BASE, HEAP_LIM) is the heap (map + fused enemy banks), then
; CODE0_BASE (code zone), STATIC_BASE (weapon/splat/muzzle data), QS_OVL.
; Bank 1: TAB_STAGE only.
; $D000-$D7FF is I/O. Play state and alog/log sit at $D800-$DFFF.
; $F000 sqt, $F800 UI font. a8_bind_tabs copies tab.prg from TAB_STAGE.
; Survives the GAME load: a8_pal_hue $06D5 (menu), video_ms $08F6, reboot stub
; $08F9, level_num $08FC, effects_vol/game_complete/difficulty $08FD-$08FF.
; mouse_en is ZP $cd.
; Low RAM through RB_CELL is the BSS ceiling (skeleton, cheats, mouse).

LOADER_BASE	= $0801
LOCODE_BASE	= $0900			; MENU overlay, then game
; $08F6 is video_ms (menu). $08F7-$08F8 are near_box_xz scratch during play.
RB_CELL		= $08F5
video_ms	= $08F6			; PAL 20 / NTSC 17, written by a8_music_start
nb_hi		= $08F7			; exclusive max of the axis under test
nb_lim		= $08F8			; Chebyshev range passed in A
REBOOT_STUB	= $08F9			; 3-byte JMP reboot_game (installed at start)
level_num	= $08FC			; 1..MAP_NLEVELS -> MAPA..
effects_vol	= $08FD			; menu SFX level 0..15
game_complete	= $08FE
difficulty	= $08FF			; menu skill 0..2 (Doofus / Freelancer / Space Bastard)
; Mouse on/off. Not $38 — GAME uses that for dt_ms.
; init_irq / LoadLevel must not clear it.
mouse_en	= $cd

; Menu player scratch. The tune itself is in the menu image (a8music.asm).
MUSIC_ZP	= $f0
MUSIC_ZP_N	= 8

TAB_STAGING	= $8000			; offsets of the tab.prg payload
TAB_ALOG	= TAB_STAGING		; 512
TAB_LOG		= TAB_STAGING + 512	; 256
TAB_SIN		= TAB_STAGING + 768	; 320
TAB_INVZL	= TAB_STAGING + 1088	; 128
TAB_INVZH	= TAB_STAGING + 1216	; 128
TAB_BYTES	= 1344

COL_BORDER	= 0
COL_WHITE	= 1			; sample_ms tripwire latch
COL_HURT	= 2			; red $d020 flash on damage
COL_BG		= 9			; default viewport background (brown)
COL_HUD_BG	= 0
COL_LINE	= 7			; default vectors (yellow)
COL_OUTSIDE	= 0			; black frame (not $d021 brown)

VIEW_COL	= 8
VIEW_ROW	= 9			; HUD occupies rows 0–8
VIEW_W		= 24
VIEW_H		= 16
VIEW_OFF	= VIEW_ROW * 40 + VIEW_COL
SCREEN_CX	= 96			; 192px viewport centre
SCREEN_XMAX	= 192
MARGIN_CH	= 192			; col 24 row 0 — solid glyph, not cleared

; PAL text starts at raster 51 (YSCROLL=3). HUD 9 rows, then 16-row viewport.
; HUD→view is untimed (row 8 is a solid black bar, see .view in irq.asm).
; Mid split: IRQ two lines before the last top-half line L, poll $d012 to L
; (the edge, not IRQ latency, anchors the write), delay past col 31, $d018.
; UI+$d021 black runs in lower flyback after the last text row.
RASTER_TOP	= 251			; flyback after last text line (row 24 ends ~250)
RASTER_VIEW	= 118			; HUD row 8 = lines 115-122; stores land ~119
RASTER_SPLIT	= 184			; IRQ here (L-2); poll to 186, then right-border write
RASTER_SPLIT_LINE	= 186		; last top-half scanline (before badline 187)

D018_A_TOP	= $04			; matrix $C000, charset $D000
D018_A_BOT	= $06			; matrix $C000, charset $D800
D018_B_TOP	= $18			; matrix $C400, charset $E000
D018_B_BOT	= $1A			; matrix $C400, charset $E800
D018_A_UI	= $0E			; matrix $C000, UI charset $F800 (HUD band always this)
D018_B_UI	= $1E			; unused — HUD is not flipped with the viewport

UI_CHARSET	= $F800
UI_FONT_PAGES	= 8			; 256 glyphs, ASCII-indexed from doomfont.png
; 40-col HUD. Seven stored rows; the two gaps are ANTIC $70 blanks
; and do not advance the memory scan.
;  0FFF              Doom64          purple
;  1          The Slipgate Complex   purple
;    (8 blank lines)
;  2                                    yellow, blue key
;  3        bits   Health  Shield  gear
;  4        0042    100     000    fire   red key
;    (8 blank lines)
;  5                  trigger message   brighter yellow
;  6 seam
HUD_ROW		= 0			; frame ms FFF
HUD_ROW_TITLE	= 0			; "Doom64" (same row as FFF)
HUD_ROW_MAP	= 1			; map display name
HUD_ROW_KEYS	= 2			; yellow / blue keys
HUD_ROW_LABEL	= 3			; labels: bits, health, shield, gear
HUD_ROW_VALUE	= 4			; values: bits, health, shield
HUD_ROW4	= 5			; trigger message
HUD_ROW_SEAM	= 6
HUD_ROW2	= HUD_ROW_KEYS		; HUD_POS writes this row
; Mode 2 takes hue from PF2 and luminance from PF1. Lum $E is the top.
HUD_PF2_TOP	= $62			; purple, background lum 2: title and map
HUD_PF1_TOP	= $0e
HUD_PF2_STAT	= $22			; the old title yellow, background lum 2: status rows
HUD_PF1_STAT	= $0e
HUD_PF1_MSG	= $0e
HUD_PF2_IDLE	= $10			; idle message row: black background
HUD_COL		= 0
HUD_OFF		= HUD_ROW * 40 + HUD_COL
HUD_OFF_TITLE	= HUD_ROW_TITLE * 40 + HUD_COL
HUD_OFF_MAP	= HUD_ROW_MAP * 40 + HUD_COL
HUD_OFF2	= HUD_ROW2 * 40 + HUD_COL
HUD_OFF_KEYS	= HUD_ROW_KEYS * 40 + HUD_COL
HUD_OFF_LABEL	= HUD_ROW_LABEL * 40 + HUD_COL
HUD_OFF_VALUE	= HUD_ROW_VALUE * 40 + HUD_COL
HUD_OFF3	= HUD_OFF_MAP		; PROFILE vertex counts, on the map line
HUD_OFF4	= HUD_ROW4 * 40 + HUD_COL
HUD_TITLE_COL	= 14			; (40 - len "Nebula Skip") / 2
HUD_ABIL_COL	= 28			; "weap" / "jump" on the values row, "gear" above
HUD_BITS_COL	= 8			; "bits" label (row 3) over its 4 digits (row 4)
HUD_HP_LABEL	= 13
HUD_AR_LABEL	= 21			; "shield"
HUD_HP_NUM	= 15
HUD_AR_NUM	= 22
HUD_KEY_COL_BLU	= 30			; keycard glyphs: yellow + blue on row 2, red on row 4
HUD_KEY_COL_YEL	= 29
HUD_KEY_COL_RED	= 32			; clear of the ability text at cols 28-31
HUD_CH_SP	= $20			; ASCII space / digits / letters in UI charset
HUD_CH_PLUS	= $2b
HUD_CH_MINUS	= $2d
HUD_CH_C	= $43
HUD_CH_U	= $55
HUD_CH_R	= $52
HUD_CH_P	= $50
HUD_CH_K	= $4b
HUD_CH_D	= $44
HUD_CH_H	= $48
HUD_CH_X	= $58
HUD_CH_Y	= $59
HUD_CH_Z	= $5a
HUD_CH_BULLET	= $7b			; glyph after 'z'
HUD_CH_KEY_RED	= $5b			; '[' .. ']' after 'Z': red, yellow, blue
HUD_CH_KEY_YEL	= $5c
HUD_CH_KEY_BLU	= $5d
COL_HUD		= 8			; orange digits
COL_HUD_DIM	= 2			; dark red stage letters

; Judd quarter-square (disk sqt @ $F000, page-aligned; mulset_* stores lo only)
; Under KERNAL — multiply only with $01=$30 (same as A-side LUTs).
sqlo		= $F000
sqhi		= $F200
negsqlo		= $F400
negsqhi		= $F600

; SMC map accessors: macros emit abs,x/y with this operand hi until LoadLevel
; patches from the map-file reloc prefix. Must not collide with a real GAME abs.
MAP_SMC_HI	= $02
MAP_SMC_BASE	= $0200
!if  (>MAP_SMC_BASE) != MAP_SMC_HI {
	!error "MAP_SMC_BASE hi must equal MAP_SMC_HI"
}

; Play BSS: default VIC matrix / leftover boot. VIC matrix in play is $C000.
; map_bss.asm occupies $0400–$0515 (play BSS starts $0524). $08F6 video_ms, $08F9–$08FF reboot stub + selectors.
ENEMY_PTR_N	= 4			; must == ENEMY_NTYPES (nebula.asm asserts)
enemy_gx_lo	= $0524
enemy_gx_hi	= enemy_gx_lo + ENEMY_PTR_N
enemy_gy_lo	= enemy_gx_hi + ENEMY_PTR_N
enemy_gy_hi	= enemy_gy_lo + ENEMY_PTR_N
enemy_gz_lo	= enemy_gy_hi + ENEMY_PTR_N
enemy_gz_hi	= enemy_gz_lo + ENEMY_PTR_N
box_vis_edges	= enemy_gz_hi + ENEMY_PTR_N	; 24
box_vis_a	= box_vis_edges			; 12 line starts
box_vis_b	= box_vis_edges + 12		; 12 line ends
pose_map_lo	= box_vis_edges + 24		; patched at pose load (logical → packed)
pose_map_hi	= pose_map_lo + ENEMY_PTR_N
enemy_sfx_evt_lo	= pose_map_hi + ENEMY_PTR_N	; cue block + clip event table on pose heap
enemy_sfx_evt_hi	= enemy_sfx_evt_lo + ENEMY_PTR_N
en_sfx_old	= enemy_sfx_evt_hi + ENEMY_PTR_N	; local frame before this anim step; fire cross-check reads it, then the sfx scan rewrites it
en_sfx_new	= en_sfx_old + 1		; logical frame after the step
en_sfx_n	= en_sfx_new + 1		; remaining events while scanning
en_sfx_armed	= en_sfx_n + 1			; 1 = frame changed this anim step
enter_wait_l	= en_sfx_armed + 1		; enter card hold ms
enter_wait_h	= enter_wait_l + 1
portb_cur	= enter_wait_h + 1		; PORTB value play wants outside a screen leaf
; 40 bytes that were the stamp row buffer. The first 25 are rig_poll's hand-over
; to the scan screen in segment E (which cannot read the map).
rig_name	= portb_cur + 1			; RIG_NAME_MAX + 1: bounty name, NUL terminated
RIG_NAME_MAX	= 23				; columns 9..31 of the "target:" row
rig_bty		= rig_name + RIG_NAME_MAX + 1	; en_bty of that corpse (bits = 4n - 1)
stamp_rowbuf	= portb_cur + 1			; layout anchor for term_row
STAMP_ROW_MAX	= 40
; DNA terminal (terminal.asm) state. All of it is initialised in term_init (start).
BITS_MAX	= 9999			; 4 HUD digits; tools/genterminal.py caps prices the same
BITS_WALLET_MIN	= 5			; bit wallet: 5..20 (min + rnd8 & BITS_SPAN)
BITS_SAFE_MIN	= 27			; bit safe: 27..42
BITS_SPAN	= 15			; mask: both ranges are 16 wide
TERM_LUM_N	= $0c			; terminal ink luminance (PF1)
TERM_LUM_HI	= $0f			; the highlighted row
TERM_PAPER_DNA	= $84			; DNA terminal paper: blue (NTSC byte, PAL-corrected at entry)
TERM_PAPER_SHIP	= $44			; ship chart paper: dark red, ink is the same hue at lum $0c = pink
TERM_PAPER_RIG	= $c4			; DNA rig scan paper: dark green (term_kind 2), ink same hue at lum $0c
TERM_COLS	= 32			; narrow playfield = the 3D viewport width
T_DESC_RULE	= 10			; list screens: rule row, description rows 11..15
TERM_ROWS	= 16			; 128 lines
TERM_DL_LEN	= 13 + 3 + (TERM_ROWS - 1) + 3
term_row	= stamp_rowbuf + STAMP_ROW_MAX	; one composed row, blitted to TERM_SCR under PORTB_MAIN
term_dl		= term_row + TERM_COLS		; live DL[0..12] + LMS + rows + JVB (no 1K crossing, asserted)
term_in		= term_dl + TERM_DL_LEN		; update_triggers: player is inside a terminal volume
term_arm	= term_in + 1			; 1 = fire was seen released while inside
term_on		= term_arm + 1			; 1 = terminal DL is up (VBI uses term_pf2)
term_pf2	= term_on + 1			; paper colour, PAL-corrected at entry
term_blood_sv	= term_pf2 + 1			; saved dli_blood operand
term_scr	= term_blood_sv + 1		; 0 main, 1 shop, 2 bounties, 3 ship chart
term_sel	= term_scr + 1			; highlighted row on this screen
term_n		= term_sel + 1			; rows on this screen incl. the return/quit row
term_old	= term_n + 1			; last input bits (edge detect)
term_tmp	= term_old + 1			; scratch
term_tmp2	= term_tmp + 1
dec5		= term_tmp2 + 1			; 5 ASCII digits from bin16_dec5
d5_lo		= dec5 + 5
d5_hi		= d5_lo + 1
d5_t		= d5_hi + 1
bits_l		= d5_t + 1			; currency (starts at 42), 16-bit
bits_h		= bits_l + 1
bounty_acc	= bits_h + 1			; 16-bit mask, bit N = bounty N accepted (its map is also marked in ship_seen)
bounty_acc_h	= bounty_acc + 1
shop_owned	= bounty_acc_h + 1		; 16-bit mask, bit N = shop item N bought
shop_owned_h	= shop_owned + 1
ship_seen	= shop_owned_h + 1		; 16-bit mask, bit N-1 = map N visited (ship chart access)
ship_seen_h	= ship_seen + 1
term_kind	= ship_seen_h + 1		; 0 DNA terminal, 1 ship chart (set by term_poll)
sh_tmp		= term_kind + 1			; ship.asm scratch (node index / cursor probe)
; DNA rig scan (rig.asm, term_kind 2 / term_scr 4). Initialised in term_init (rig_*) and
; init_enemies (en_scan).
ENEMY_MAX	= 24			; MAP_NENEMIES ≤ this
TRIG_RIG	= 15			; term_in pseudo-purpose set by rig_poll (never a cooked trigger)
RIG_R		= 3			; scan range: Chebyshev cells from the corpse
RIG_BAR_N	= 28			; '#' cells on the upload bar
RIG_DONE	= 8			; rig_stage once the bounty is paid: fire closes the screen
rig_idx		= sh_tmp + 1			; enemy being scanned (poll hit, then the open screen)
rig_arm		= rig_idx + 1			; 1 = fire was seen released while a corpse was in range
rig_shown	= rig_arm + 1			; 1 = the prompt is on the message row
rig_stage	= rig_shown + 1			; 0 name .. 6 bar, 7 pay, RIG_DONE
rig_wait_l	= rig_stage + 1			; ms until the next stage (16-bit, counts down)
rig_wait_h	= rig_wait_l + 1
rig_cnt		= rig_wait_h + 1		; crimes to print, 1..3
rig_k		= rig_cnt + 1			; crimes printed so far
rig_col		= rig_k + 1			; next free column on the crimes row
rig_row		= rig_col + 1			; crimes row being filled
rig_bar		= rig_row + 1			; '#' printed
rig_c		= rig_bar + 1			; 5 crime indices
en_scan		= rig_c + 5			; ENEMY_MAX: 1 = bounty collected (quicksaved)
TERM_BSS_END	= en_scan + ENEMY_MAX
play_bss_free	= TERM_BSS_END			; th_taken (TH_MAX) sits here; the rest is free up to a8_pal_hue
TERM_SCR	= BMP_B				; 16 x 32 = 512 B of ANTIC text, main RAM under the window
!if  >term_dl != >(term_dl + TERM_DL_LEN - 1) {
	!error "term_dl crosses a page (DL must not cross 1K)"
}
; Menu set_video_ms writes this while the boot loader ($0480–boot_end) is still
; live. Fixed above that image, below skip_n. GAME loads at $0900 and leaves it.
; NTSC never reads it.
a8_pal_hue	= $06d5				; 16: NTSC hue → PAL high nibble, lum 0
a8_hue_lo	= a8_pal_hue + 16		; a8_to_pal luminance scratch
!if  play_bss_free > a8_pal_hue {
	!error "play BSS overlaps the PAL hue table"
}
; genenemies.py ENEMY_DATA_BASE must match.
; Per-type cue ids ride on the pose heap, not here: enemy_sfx_evt_* points at the
; 5-byte cue block, and the clip event table follows it (CUE_N bytes in).
CUE_SIGHT	= 0			; generic: enemy_enter_alert
CUE_WINCE	= 1			; generic: pain entry
CUE_MELEE	= 2			; clip-timed
CUE_SHOOT	= 3			; clip-timed
CUE_DEATH	= 4			; generic: kill_enemy
CUE_N		= 5
CUE_NONE	= $ff			; $00 is a real sound
ENEMY_DATA_BASE	= $0701			; boot-loaded enemy_data_blob.asm
!if  ENEMY_DATA_BASE != $0701 {
	!error "tools/genenemies.py ENEMY_DATA_BASE must be $0701"
}
!if  a8_hue_lo >= ENEMY_DATA_BASE {
	!error "PAL hue table overlaps enemy data"
}
; Boot skip_n is $06F0. The reboot stub uses $06F0–$06F3 while loading GAME.
!if  a8_hue_lo >= $06f0 {
	!error "PAL hue table hits boot scratch"
}
; Pose prefix copied into one of two resident rows. Offsets match genenemies.py.
META_STAND_START	= 0
META_ROW		= 34
AI_ENTRY_LO	= $0850			; streamed AI entry pointer per enemy type
AI_ENTRY_HI	= AI_ENTRY_LO + ENEMY_PTR_N
ENEMY_DATA_LIMIT	= AI_ENTRY_LO
AI_BANK_LO	= AI_ENTRY_HI + ENEMY_PTR_N	; base of complete fused bank per type
AI_BANK_HI	= AI_BANK_LO + ENEMY_PTR_N
AI_LOW_END	= AI_BANK_HI + ENEMY_PTR_N
; Custom-skeleton runtime. skel_base = 0 means this type has no pose prefix.
; A bound prefix with skel_nv = 0 is an empty graph and draws nothing.
skel_nv		= AI_LOW_END			; ENEMY_PTR_N
skel_ne		= skel_nv + ENEMY_PTR_N
skel_base_lo	= skel_ne + ENEMY_PTR_N		; pose prefix in the bank
skel_base_hi	= skel_base_lo + ENEMY_PTR_N
skel_mul_n	= skel_base_hi + ENEMY_PTR_N
SKEL_BSS_END	= skel_mul_n + 1
!if  SKEL_BSS_END > RB_CELL {
	!error "skeleton BSS overlaps rb_n cell"
}
; Cassette buffer / $0334-$03FF (204 B): free during play (KERNAL disk LOAD/SAVE
; never touches it). Not $02xx (MAP_SMC_HI sentinel), not $0314-$0319 (vectors).
; Atari: $0200-$03F9 is the text matrix and display list, so the line/sound
; tables sit under the NMI vectors ($FFFA).

LINE_TAB	= $FF40

LINE_TAB_END	= LINE_TAB + 72
SOUND_TABLE	= LINE_TAB_END		; sound_table: SOUND_COUNT words (playsound.asm)

SOUND_TABLE_MAX	= 128


; Shift-S / Shift-L. a8_keys sets the latch once per press (qk_held stays 1
; until all keys are up), poll_quick_keys clears it. in_qload must follow
; in_qsave (a8_keys indexes them). qk_held is not cleared by init_irq: a
; key still down after a quickload must not fire again.
in_qsave	= SKEL_BSS_END
in_qload	= in_qsave + 1
qk_held		= in_qload + 1
ls_first	= qk_held + 1		; 1 = line_solids_* stops at the first hit
sl_end		= ls_first + 1		; room-slice loop bound (leaf loops only, never nested)
ut_end		= sl_end + 1		; update_triggers slice bound (trig_enter may reach sl_end users)
QS_LATCH_END	= ut_end + 1
; Quicksave slot: the last QSAVE_N sectors of the ATR (tools/mkatr.py checks
; both numbers). The QSAVE overlay (a8qsave.asm) is loaded over bitmap A at
; QS_OVL, above the three context pages a8_ctx_save parks at the top of the
; draw bitmap, run with the screen blanked (den_arm = 1), and wiped after.
QSAVE_N		= 5
QSAVE_SEC	= 1036
QS_OVL		= $7900			; in bank 0: code 1081 B + qso_buf 640 B, ends by $8000
QS_OVL_LIMIT	= $8000
!if  QS_LATCH_END > RB_CELL {
	!error "quicksave latches overlap rb_n"
}
; Cheat FSM + god_mode. Outside the quicksave image ($CB70–$D000) and not
; cleared by game_zp_init / LoadLevel, so god mode survives map<C> and death.
; Cleared once from start. Hole ends at RB_CELL.
god_mode	= QS_LATCH_END		; 1 = god, take_damage returns
cheat_god	= god_mode + 1		; table offset; cheat_bit, cheat_map follow
cheat_bit	= cheat_god + 1
cheat_map	= cheat_bit + 1		; at table end = waiting for the map letter
cheat_map_latch	= cheat_map + 1		; level 1..26 for main
cheat_was	= cheat_map_latch + 1	; 4 rising-edge slots
cheat_dig_prev	= cheat_was + 4
cheat_a		= cheat_dig_prev + 1
cheat_b		= cheat_a + 1
cheat_c		= cheat_b + 1
cheat_req	= cheat_c + 1		; 0 / CHEAT_REQ_*
cheat_kdown	= cheat_req + 1		; 0 = saw key up, else KBCODE+1. Not in cheat_was
CHEAT_BSS_END	= cheat_kdown + 1
; ST mouse port 2, X quadrature. Play only. mouse_en itself is ZP $cd.
mouse_x		= CHEAT_BSS_END		; previous raw 2-bit X state (pins 1–2, active low)
mouse_turn	= mouse_x + 1		; 16-bit signed sum of steps (2 = 1 yaw tick)
mouse_turn_h	= mouse_turn + 1
mouse_f		= mouse_turn_h + 1		; fast-mode timer: samples left (0 = slow decode)
mouse_rem	= mouse_f + 1		; sub-tick remainder (0..1) carried between frames
mouse_lim	= mouse_rem + 1		; read_input: max |ticks| this frame (2x stick rate)
mouse_v		= mouse_lim + 1		; last step direction (+1 / $ff), sign for a 2-step sample
MOUSE_BSS_END	= mouse_v + 1
!if  MOUSE_BSS_END > RB_CELL {
	!error "mouse BSS overlaps rb_n"
}

SKEL_PFX	= 4			; size.w, nv, ne; one baked batch follows

AI_BANK_MAGIC0	= 'Q'
AI_BANK_MAGIC1	= 'A'
AI_BANK_MAGIC2	= 'I'
AI_BANK_MAGIC3	= '1'
AIH_CODE_SIZE	= 4
AIH_RELOC_N	= 6
AIH_MAP_N	= 8
AIH_ENTRY	= 10
AIH_POSE_OFF	= 12
AIH_FLAGS	= 14
AIH_SIZE	= 15
; AI banks are assembled here and relocated by delta into the bank-0 heap.
; genaimeta.py treats every absolute operand inside [AI_LINK_BASE, +size) as
; internal, so no GAME symbol (code, BSS, hardware) may sit in that span. $4000
; is main-RAM bitmap A and holds no symbol an AI module references.
AI_LINK_BASE	= $4000
; PORTB: OS ROM off, BASIC off, ANTIC on main RAM. Bits 2-3 = bank, bit 4 = 0
; maps the bank over $4000-$7FFF for the CPU only.
PORTB_MAIN	= $fe			; window shows main RAM (bitmaps)
PORTB_PLAY	= $e2			; window shows bank 0 (heap, code zone, static data)
PORTB_BANK1	= $e6			; window shows bank 1 (tab LUT source only)
PORTB_OS	= $ff			; OS ROM on (SIOV only)
; Segment E: main RAM under the bank window, above the two bitmaps. Visible only
; with PORTB_MAIN, so the bitmaps are visible with it. Separate assemble
; (sege.asm -> GAMEE, loaded by load_game_segments); GAME reaches it through the
; jmp table at SEG_E_BASE with portb_cur = PORTB_MAIN (e_call in a8stamp.asm).
; Rules: no map accessors (_mx/_my patch sites) in E, no calls from E into the
; bank-0 code zone, never from NMI.
SEG_E_BASE	= $6000
SEG_E_LIMIT	= $8000
E_STAMP_VIEW	= SEG_E_BASE		; A = 1 when the tracked splat is on screen
E_TERMINAL	= SEG_E_BASE + 3	; terminal_run (terminal / ship chart / rig scan)
E_ITEM_SLOT	= SEG_E_BASE + 6	; fill_item_slot (item / door mesh tables)
; Bank 0 layout (CPU addresses with PORTB_PLAY).
DYN_BASE	= $4000			; heap floor
HEAP_LIM	= $5e00			; heap ceiling = CODE0_BASE (heap 7680 B)
; Code zone: modules that only run from the main loop at PORTB_PLAY (weapon,
; process, elevator, cheats_apply). Loaded once at boot with BANK0. Not
; callable from NMI/DLI, with the OS on, inside a screen leaf, or before boot.
CODE0_BASE	= $5e00
STATIC_BASE	= $6b40			; terminal tables and text (sprites live in segment E)
CODE0_END	= STATIC_BASE
STATIC_END	= $7900
!if QS_OVL != STATIC_END {
	!error "QS_OVL must equal STATIC_END"
}
; Boot parks tab.prg in bank 1 (survives menu and reboot); a8_bind_tabs copies
; it into the LUTs at every GAME start. tab.prg payload is 1344 B.
TAB_STAGE	= $4000
AI_CMD_ATTACK_TICK	= 0
AI_CMD_FIRE		= 1
AI_CMD_ATTACK_END	= 2
AI_CMD_DYING_STEP	= 3
AI_CMD_APPROACH_MOVE	= 4
AI_CMD_APPROACH_ATTACK	= 5
AI_CMD_APPROACH_ENTER	= 6
AI_CMD_IDLE		= 7
AI_CMD_DRAW		= 8
AI_CMD_PAIN		= 9
AI_CMD_ANIM_FIRE	= 11		; 10, 12–17 unused; do not renumber
AI_AP_MOVE		= 0
AI_AP_STAND		= 1
AI_AP_NEXT		= 2

; Unique charset-tail LUTs. Char 192 ($x600) is $FF×8 in all four halves.
; ALOG is two pages (ALOGHI replaces ALOGTAB+$100). COSTAB = SINTAB+64.
; Atari: $D000-$D7FF is I/O. Bitmap B is the $E000 4K (ANTIC does not
; carry a screen pointer across a 4K boundary). Play state + alog/log
; sit in the RAM at $D800-$DFFF, under that bitmap.

SINTAB		= $FC00			; 320 bytes
COSTAB		= SINTAB + 64
invzl		= $FD40			; 128
invzh		= $FDC0			; 128
ALOGTAB		= $FE40			; 256
ALOGHI		= $DE00			; 256, after the $D800 play block
LOGTAB		= $DF00			; 256


SCR_A		= $C000
SCR_B		= $C400
CH_A_TOP	= $D000
CH_A_BOT	= $D800
CH_B_TOP	= $E000
CH_B_BOT	= $E800
MARGIN_GLYPH	= CH_A_TOP + 24 * 64	; $D600 — char 192, A top


A8_OFF		= $0E00			; $CA00-$CFFF -> $D800-$DDFF (under bitmap B)

PROJ_X		= $CA00 + A8_OFF			; 16 view/proj slots
PROJ_Y		= $CA10 + A8_OFF
PROJ_Z		= $CA20 + A8_OFF
CAM_X		= $CA30 + A8_OFF
CAM_Y		= $CA40 + A8_OFF
CAM_Z		= $CA50 + A8_OFF
PROJ_XH		= $CA60 + A8_OFF
PROJ_YH		= $CA70 + A8_OFF
CAM_XH		= $CA80 + A8_OFF
CAM_YH		= $CA90 + A8_OFF
CAM_ZH		= $CAA0 + A8_OFF
PROJ_ZH		= $CAB0 + A8_OFF
EDGE_VIS	= $CAC0 + A8_OFF			; 32 edge flags (tetromino rooms ≤28)
CLIP_X0		= $CAE0 + A8_OFF
CLIP_Y0		= $CB00 + A8_OFF
CLIP_X1		= $CB20 + A8_OFF
CLIP_Y1		= $CB40 + A8_OFF
frame_t0	= $CB60 + A8_OFF			; 4-byte CIA2 cascade snapshot
frame_cy	= $CB64 + A8_OFF
casc_now	= $CB68 + A8_OFF

FOCAL		= 100
LOG_FOCAL	= 213			; round(32*log2(100))
MESH_MAX_VERTS	= 16			; CAM/PROJ / VOC / COL_* slot count
MESH_MAX_EDGES	= 32			; EDGE_VIS / CLIP_* slot count
ANIM_MS		= 100			; walk step interval (ms)
ZCLIP		= $0100			; 1.0 near plane (8.8)
YAW_STEP	= 3
PITCH_STEP	= 2
PITCH_MIN	= $d0			; -48, signed about horizon 0
PITCH_MAX	= 48
KEY_W		= 1
KEY_A		= 2
KEY_S		= 4
KEY_D		= 8
KEY_I		= 16
KEY_J		= 32
KEY_L		= 128
PERSP_MAX	= 127
CLIP_XMIN	= -96			; signed offset: x 0..191
CLIP_XMAX	= 95
CLIP_YMIN	= -64			; y 0..127
CLIP_YMAX	= 63
OC_LEFT		= 1
OC_RIGHT	= 2
OC_TOP		= 4
OC_BOT		= 8
OC_NEAR		= $80			; VOC only: z < ZCLIP (screen bits not set)

; Player / world
EYE_HEIGHT	= 3			; integer part of the eye height; feet = cam_yh - EYE_HEIGHT
EYE_FRAC	= $c0			; + 0.75 in cam_yl: the eye rides 3.75 above the feet
PLAYER_H	= 4			; Y collision height [feet, feet+PLAYER_H)
DOOR_Y_SLACK	= 1			; |feet − door_y| to fire a wish-through
DOOR_AIM	= 32			; yaw ticks (45°) of through-heading to transit
MOVE_SPEED	= 2			; 8.8 step scale (asl count after wish)
PLAYER_R	= 1			; XZ collision radius
; XZ Chebyshev vs player is per type: enemy_block_r (editor blockR, meta row tail)
FALL_LEDGE	= 1			; start fall if feet-floor > this
STEP_UP		= 2			; max walk-up; 2 units plays SOUND_OOF
FALL_TICK_MS	= 32			; gravity cadence (like MOTION_STEP_MS)
; Gravity and jump speed are per map (map_grav / map_jump_v, map_bss.asm). The
; editor sets them in units/s and units/s^2; genmap.py packs them for this tick.
FALL_SAFE	= 8			; no damage if eye-drop <= this
FALL_DAMAGE	= 15			; HP on hard landing
ABIL_FIRE	= 0			; joystick button ability (space toggles)
ABIL_JUMP	= 1
ABIL_SCAN	= 2			; DNA rig (shop item): fire near a bounty corpse opens the scan screen
ROOM_NOCOMBAT	= 1			; room_bg bit 0 (unused by the paper byte): no fire mode, enemies stand
ROOM_OPEN_SKY	= 1			; room_flags bit 0: no ceiling, a jump rises past room_y+room_sy
HURT_FLASH_MS	= 300			; red border duration
ENEMY_CULL_R	= 2			; view-space |x| vs z+R (8.8 high)
ENEMY_CULL_H	= 6			; view-space |y| vs z+H (figure height)
; ENEMY_MAX lives with the terminal BSS above (en_scan is sized by it).
EN_IDLE		= 0
EN_ALERT		= 2			; 1 reserved; do not renumber
EN_APPROACH		= 3
EN_ATTACK		= 4
EN_PAIN		= 5
EN_DYING		= 6
EN_DEAD		= 7			; last death frame; stays until level reload
EN_GONE		= 8
ENEMY_DETECT	= 32		; Chebyshev XZ wake distance
ENEMY_STEP_MS	= 200		; approach cell cadence (dt acc + remainder)
ENEMY_STEP_JIT	= $7f		; approach entry step phase mask, < ENEMY_STEP_MS
GRUNT_BACKOFF	= 8		; Chebyshev ≤ this → weight dodge away from player
DOOM_STEP_MS	= 300		; Human / Imp / Pinky / Baron cell cadence
DOOM_ATK_MS	= 256		; reattack after a claw or fireball
GRUNT_ATK_MS	= DOOM_ATK_MS	; human post-shot pause. Sight delay is the 0–1023 roll in ai_human
IMP_ATK_MS	= 2500		; imp post-attack pause; sight and pain leave the timer at 0. ~4 s between throws with the clip tail
DEMON_MELEE_R	= 4		; claw Chebyshev
SHOT_Z_MAX	= 32			; view-Z high max range
SHOT_MID_H	= 3			; mid-body Y above feet (≈ ENEMY_CULL_H/2)
PISTOL_DMG_MAX	= 16			; (rnd >> 4) + 1
PISTOL_HIT_X	= 12			; SquareDoom aim cols 18..22 on a 40-col view
PISTOL_FIRE_MS	= 600			; 30 ticks × 20 ms

ITEM_CULL_Y	= 2			; AABB |y| vs Chebyshev XZ + pad
FOV_HALF	= 31			; yaw ticks ≈ atan(SCREEN_CX/FOCAL)

; Process SoA + mutable map state in VIC-bank scratch past profiler
PROC_NUM	= 8
PROC_FREE	= 0
PROC_TIMER	= 1
PROC_OPEN_DOOR	= 2
PROC_LOWER_DOOR	= 3
PROC_LOWER_ELEV	= 4
PROC_RAISE_ELEV	= 5

PROC_KIND	= $CB70 + A8_OFF
PROC_A		= $CB78 + A8_OFF			; world object id (door_id / elev_id)
PROC_B		= $CB80 + A8_OFF			; dest / next kind
PROC_C		= $CB88 + A8_OFF			; timer/accum lo
PROC_D		= $CB90 + A8_OFF			; timer/accum hi
PROC_E		= $CB98 + A8_OFF			; elev home return Y
PROC_L		= $CBA0 + A8_OFF			; local door/elev SoA index
floor_slope	= $CBA8 + A8_OFF			; 1 if this frame's floor is a ramp
trig_inside	= $CBA9 + A8_OFF			; occupancy bits, Nth same-room trigger
hurt_ms_l	= $CBAA + A8_OFF			; hurt-trigger cooldown remaining
hurt_ms_h	= $CBAB + A8_OFF
vic_border	= $CBAC + A8_OFF			; staged $d020 (IRQ)
palette_dirty	= $CBAD + A8_OFF			; 1 = IRQ refill viewport colour RAM
HURT_MS		= 1000			; hurt trigger period (both sizes)
HURT_SM_HP	= 2			; small hurt, once per second
HURT_LG_HP	= 10			; large hurt, once per second

; $CBB0 was elev_y (now $CFE2).
ledge_i		= $CBB0 + A8_OFF			; ledge_unstick neighbor 0..7
spawn_match	= $CBB1 + A8_OFF			; enemy tag id while .te_spawn scans
pickup_ms_l	= $CBB2 + A8_OFF			; pickup hold-off remaining (ms): no grabs while > 0
pickup_ms_h	= $CBB3 + A8_OFF
PICKUP_HOLD_MS	= 1000			; pause after a grab so a cluster reads one item at a time
elev_noise_n	= $CBB4 + A8_OFF			; refcount: SID V3 rumble while elevs move
den_arm		= $CBB5 + A8_OFF			; 1 = DEN held off, 2 = view IRQ may set DEN
pub_ff		= $CBB6 + A8_OFF			; frame_flag when the draw buffer was published
pub_ph		= $CBB7 + A8_OFF			; irq_phase then (0 = before this frame's view IRQ)
proc_tmp0	= $CBB8 + A8_OFF
proc_tmp1	= $CBB9 + A8_OFF
proc_tmp2	= $CBBA + A8_OFF
proc_tmp3	= $CBBB + A8_OFF
proc_tmp4	= $CBBC + A8_OFF
proc_tmp5	= $CBBD + A8_OFF
MOTION_STEP_MS	= 64
ELEV_STEP_MS	= 128			; half elevator travel speed vs doors
ELEV_FLAG_SLOW	= 1			; elev_flags bit0: step every 512 ms
DOOR_RECLOSE_MS	= 5000
DOOR_UNHIDE_MS	= 10000		; unhide trigger, then hidden again
ELEV_WAIT_MS	= 5000
STATUS_MS	= 5000			; backpack / status HUD line

; Box / mesh draw
BOX_NVERTS	= 8
BOX_NEDGES	= 12
HUD_MSG_COL	= 0
HUD_MSG_W	= 40
SAMPLE_MS_PAL	= 20			; ms per mid-split tick (50 Hz)
SAMPLE_MS_NTSC	= 17			; ≈1000/60
in_fwd		= $CBBE + A8_OFF			; 16-bit hold ms (IRQ accum)
in_back		= $CBC0 + A8_OFF
in_strafel	= $CBC2 + A8_OFF
in_strafer	= $CBC4 + A8_OFF
in_turn_l	= $CBC6 + A8_OFF
in_turn_r	= $CBC8 + A8_OFF
hold_fwd	= $CBCA + A8_OFF			; 16-bit snapshots (read_input)
hold_back	= $CBCC + A8_OFF
hold_strafel	= $CBCE + A8_OFF
hold_strafer	= $CBD0 + A8_OFF
hold_turn_l	= $CBD2 + A8_OFF
hold_turn_r	= $CBD4 + A8_OFF
in_ability	= $CBD6 + A8_OFF			; space press (IRQ), one-shot
key_ability	= $CBD7 + A8_OFF			; latched by snapshot_input
key_use_was	= $CBD8 + A8_OFF			; door_blk rising edge
pl_falling	= $CBD9 + A8_OFF			; 0 grounded, 1 airborne
fall_vl		= $CBDA + A8_OFF			; 8.8 downward vel lo
fall_vh		= $CBDB + A8_OFF
fall_y0		= $CBDC + A8_OFF			; cam_yh when fall started
fall_acc	= $CBDD + A8_OFF			; leftover ms toward FALL_TICK_MS

; Unique world X/Z + 8.8 sin/cos products for xform_mesh_xz (6+6 unique, 16 verts)
UX		= $CBDE + A8_OFF			; 6 bytes
UZ		= $CBE4 + A8_OFF
VY		= $CBEA + A8_OFF			; 16 bytes (vert Y)
XC_L		= $CBFA + A8_OFF			; 6
XC_H		= $CC00 + A8_OFF
XS_L		= $CC06 + A8_OFF
XS_H		= $CC0C + A8_OFF
ZC_L		= $CC12 + A8_OFF
ZC_H		= $CC18 + A8_OFF
ZS_L		= $CC1E + A8_OFF
ZS_H		= $CC24 + A8_OFF			; last byte $CC29

; Hardware sprite view-model (VIC bank 3). Each body, flash, muzzle, and
; splat is one clipped rect (x_byte, y, width, height, row-major plane).
; emuz_src / splat_src point at that header. Buffers sit under the heap
; ceiling so they miss bitmap A.

WPN_RAM		= $BE00
WPN_FLASH	= $BF00
WPN_EMUZ	= $BF80
WPN_SPLAT	= $BFC0
HUD_SCR		= $0200
BMP_A		= $4000			; 4K, does not cross a 4K boundary; main RAM under the bank window
; Menu writes the game display list here on exit. Tail of GAME segment D's
; page (D ends below it, so GAMED never overwrites it): RAM, nothing between
; menu exit and init_vic touches it.
GAME_DL_STAGE	= $ef40
GAME_DL_N	= 146			; 14 head + LMS + 127 lines + JVB
GAME_DL_JVB	= 144			; address word; byte 143 is the $41
BMP_B		= $5000
WPN_PTR0	= 0
WPN_PTR_FLASH	= 0
WPN_PTR_EMUZ	= 0
WPN_PTR_SPLAT	= 0

COL_FX		= 1 			; enemy muzzle sprite colour (C64 only)
COL_SPLAT_HIT	= 2			; red (blood) (DO NOT CHANGE BACK TO PINK!)
COL_SPLAT_MISS	= 0			; wall hit / spark; must differ from COL_SPLAT_HIT
SPLAT_MSB	= $80			; $d010 / $d015 bit for sprite 7
WPN_X0		= 160			; pistol left edge (screen X)
WPN_Y_PISTIDLE	= 224		; 32px art; −6 kick still meets the viewport bottom
; Rect size is per sprite (byte-aligned x, ink-tight y), not a fixed 24×21.
FLASH_X_C	= 172			; 24px flash centred on visual 184
FLASH_YEL_MS	= 60
FLASH_RED_MS	= 60
SPLAT_MS		= FLASH_YEL_MS + FLASH_RED_MS	; same total as muzzle flash
FX_N			= 24			; one explosion, 24 pixels
EXPLODE_MS		= 768			; ~3× frame budget for particle expand
FX_START_MS		= 100			; spawn elapsed head-start (skip origin speck)
FX_VEL_SPEED		= 32			; (dir*speed)>>7 → ~±31 into 8.8
RKT_MAX		= 4
RKT_OWN_PL		= 0
RKT_OWN_EN		= 1
RKT_F_PEND		= 2			; waiting on fx_on
RKT_F_FIREBALL		= 4			; fireball: clear on impact, no splash
RKT_F_BARON		= 8			; baron fireball (base 30, else 10)
RKT_TICK_MS		= 32
RKT_SPEED		= 30			; enemy horizontal, before aim
RKT_SPEED_PL		= 64			; player horizontal
RKT_LIFE_MS		= 5000
RKT_DMG_BASE		= 16			; splash 16 + (rnd & 31)
RKT_RAD		= 8
RKT_HIT_R		= 1
BARREL_CHAIN_MS		= 256		; gap so the previous burst is visible
RKT_WRIST_L		= 5			; skeleton "Wrist L"
RKT_WRIST_R		= 7			; skeleton "Wrist R"
RKT_R			= $60			; screen-triangle half-extent 0.375
RKT_VEL_ASR		= 5			; tip = view-vel >> 5
VIEW_SPR_X0	= 24 + VIEW_COL * 8	; 88 — viewport (0,0) → VIC
VIEW_SPR_Y0	= 50 + VIEW_ROW * 8	; 122
SPLAT_INSET_X	= 24		; melee cue never on viewport edge (0..191)
SPLAT_INSET_Y	= 16		; 0..127
EMUZ_OX		= 12			; tip −12 X (center 24px)
EMUZ_OY		= 10			; tip −10 Y (center 21px)
EMUZ_MS		= 100
EMUZ_MSB	= $40			; $d010 / $d015 bit for sprite 6
EMUZ_Z0		= 8			; tip CAM_ZH LOD bands → spr 0..2
EMUZ_Z1		= 16

; Weapon BSS (after unique-XZ products)
in_fire		= $CC2A + A8_OFF
key_fire	= $CC2F + A8_OFF
wpn_pose	= $CC35 + A8_OFF			; POSE_*
fire_rpt_l	= $CC36 + A8_OFF
fire_rpt_h	= $CC37 + A8_OFF
; Line-vs-AABB temps (util.asm). Not rot0–rot2.
ln_r0		= $CC38 + A8_OFF
ln_r1		= $CC39 + A8_OFF
ln_r2		= $CC3A + A8_OFF
wpn_y		= $CC3D + A8_OFF
anim_step	= $CC3F + A8_OFF
anim_ms_l	= $CC40 + A8_OFF
anim_ms_h	= $CC41 + A8_OFF
wpn_tmp0	= $CC44 + A8_OFF
ws_slot		= $CC45 + A8_OFF			; WS_EMUZ / WS_SPLAT during start_world_spr
; Pose stream scratch
need0		= $CC46 + A8_OFF			; type id or $FF
need1		= $CC47 + A8_OFF			; type id or $FF
pose_dump	= $CC48 + A8_OFF			; type being dumped
pose_keep	= $CC49 + A8_OFF			; surviving type while dumping ($FF = none)
load_device	= $CC4A + A8_OFF			; IEC device (KERNAL $ba is not ours during play)
emuz_xmsb	= $CC4B + A8_OFF			; $d010 bit6 when X>=256
item_spin	= $CC4C + A8_OFF			; world pickup yaw (0..255)
item_spin_l	= $CC4D + A8_OFF			; 8.8 fraction
map_sv_a	= $CC4E + A8_OFF			; heap_alloc size hi scratch
map_sv_y	= $CC4F + A8_OFF			; enemy slot / keep type scratch
bind_cur	= $CC50 + A8_OFF			; word: bind_map cursor
heap_top	= $CC52 + A8_OFF			; word: next LOAD dest (grows down from SCR_A)
map_base	= $CC54 + A8_OFF			; word: packed map payload
load_dest	= $CC56 + A8_OFF			; word: current LOAD dest
load_in_play	= $CC58 + A8_OFF
load_namelen	= $CC59 + A8_OFF
load_name_l	= $CC5A + A8_OFF
load_name_h	= $CC5B + A8_OFF
load_type	= $CC5C + A8_OFF
bind_n		= $CC5D + A8_OFF
reloc_base	= $CC5E + A8_OFF			; word: reloc dest words in the map prefix

; Per-vertex clip data hoisted out of mesh_clip (16 slots each)
VOC		= $CC60 + A8_OFF			; Cohen–Sutherland outcode, or OC_NEAR
clip_n		= $CC70 + A8_OFF			; mesh_clip edges left
nc_n		= $CC71 + A8_OFF			; near clip: scaled (ZCLIP - zB) / (zF - zB)
nc_d		= $CC72 + A8_OFF
nc_v		= $CC73 + A8_OFF			; near clip: CAM index across lerp16
nc_s		= $CC74 + A8_OFF			; near clip: behind endpoint's ox/oy slot (0/4)
emuz_src	= $CC75 + A8_OFF			; clipped muzzle rect
ammo_bullets	= $CC77 + A8_OFF			; pistol reserve (not in the $CD00 block)
have_pack	= $CC7A + A8_OFF			; 1 = backpack raised ammo caps
gb_cap		= $CC7B + A8_OFF			; grant_th_type effective max
wpn_bob_ph	= $CC7F + A8_OFF			; walk bob index 0..127; 0 = rest
VSX		= $CC80 + A8_OFF			; screen X/Y (front verts with outcode 0)
VSY		= $CC90 + A8_OFF

; Per-XZ-column project cache (verts sharing x,z share z_eye/inv/PROJ_X)
COL_DONE	= $CCA0 + A8_OFF			; 0 = new, 1 = front cached, 2 = behind
COL_INVL	= $CCB0 + A8_OFF
COL_INVH	= $CCC0 + A8_OFF
COL_INVK	= $CCD0 + A8_OFF
COL_PXL		= $CCE0 + A8_OFF
COL_PXH		= $CCF0 + A8_OFF

; Player inventory + thing taken flags (after project cache)
AMMO_BULLETS_MAX	= 200
AMMO_BULLETS_BOX	= 50
AMMO_BULLETS_START	= 50			; SquareDoom pistol reserve
PLAYER_HP_MAX		= 100
PLAYER_HP_START		= 100
HP_SOUL_MAX		= 200
PLAYER_ARMOUR_START	= 0
PLAYER_ARMOUR_MAX	= 200
HP_STIM			= 10
HP_MEDIKIT		= 25
HP_SOUL			= 100
ARMOR_GREEN		= 100
ARMOR_BLUE		= 200
TH_FOOT_SX		= 2			; AABB around equilateral-ish base
TH_FOOT_SZ		= 2
TH_FOOT_SY		= 2			; ≈ 1.5 tall (C64 int)
!if TH_FOOT_SX != TH_FOOT_SY {
	!error "set_th_foot_box stores one extent into sx/sy/sz"
}
!if TH_FOOT_SX != TH_FOOT_SZ {
	!error "set_th_foot_box stores one extent into sx/sy/sz"
}
TH_GRAB_R		= 3			; Chebyshev pad outside that footprint
TH_MAX			= 128		; MAP_NTHINGS ≤ this; keep in sync with tools/genmap.py

combat_armor	= $CD01 + A8_OFF			; 1 = blue (saves 1/2); 0 = green
; $CD04-$CD23 free (was th_taken while TH_MAX was 32).
th_taken	= play_bss_free				; MAP_NTHINGS (≤ TH_MAX), main RAM below the bank window
!if  th_taken + TH_MAX > a8_pal_hue {
	!error "th_taken overlaps the PAL hue table: end=", th_taken + TH_MAX
}
player_hp	= $CD24 + A8_OFF			; 0..PLAYER_HP_MAX
player_armour	= $CD25 + A8_OFF			; 0..PLAYER_ARMOUR_MAX
en_state	= $CD26 + A8_OFF			; ENEMY_MAX: EN_*
en_frame	= $CD3E + A8_OFF			; ENEMY_MAX: local frame in current clip
drop_taken	= $CD56 + A8_OFF			; ENEMY_MAX: 1=inactive/taken, 0=active
drop_x		= $CD6E + A8_OFF
drop_y		= $CD86 + A8_OFF
drop_z		= $CD9E + A8_OFF
drop_room	= $CDB6 + A8_OFF
drop_type	= $CDCE + A8_OFF			; TH_* when active
en_hp		= $CDE6 + A8_OFF			; ENEMY_MAX
en_timer	= $CDFE + A8_OFF			; ENEMY_MAX: attack pause / dog idle / death hold ms lo
en_timer_h	= $CE16 + A8_OFF			; ENEMY_MAX: attack pause / dog idle / death hold ms hi
en_step		= $CE2E + A8_OFF			; ENEMY_MAX: walk acc lo
en_step_h	= $CE46 + A8_OFF			; ENEMY_MAX: walk acc hi
en_dir		= $CE5E + A8_OFF			; ENEMY_MAX: 0..7 dodge facing
gunshot_wake	= $CE76 + A8_OFF			; 1 = gun fired this frame (room wake)
ai_dirtry	= $CE77 + A8_OFF			; 5 bytes dodge dir candidates
ai_turn		= $CE7C + A8_OFF			; turnaround dir or $ff
ai_probe	= $CE7D + A8_OFF			; dir under test (probe must not clobber)
emuz_vx		= $CE7E + A8_OFF			; VIC X lo staged (IRQ apply_en)
emuz_vy		= $CE7F + A8_OFF			; VIC Y staged
emuz_col		= $CE80 + A8_OFF			; sprite colour staged (C64 only)
emuz_pending	= $CE81 + A8_OFF			; enemy idx waiting to muzzle, $ff = none
fb_probe_y	= $CE82 + A8_OFF			; floor_below: inclusive max walkable Y
death_wait_l	= $CE83 + A8_OFF			; death hold ms acc
death_wait_h	= $CE84 + A8_OFF
col_room	= $CE85 + A8_OFF			; collision room for inset/floor/solid
splat_xmsb	= $CE86 + A8_OFF			; $d010 bit7 when X>=256
splat_vx		= $CE87 + A8_OFF
splat_vy		= $CE88 + A8_OFF
splat_col	= $CE89 + A8_OFF			; COL_SPLAT_HIT or COL_SPLAT_MISS
trig_seen	= $CE8A + A8_OFF			; update_triggers: b0=hurt ticked, b1=msg overlap
shot_hit_i	= $CE8B + A8_OFF			; closest hitscan enemy, $ff = miss
shot_hit_z	= $CE8C + A8_OFF			; CAM_ZH of that hit
hurt_flash_l	= $CE8D + A8_OFF			; remaining red-border ms
hurt_flash_h	= $CE8E + A8_OFF
bite_splat_i	= $CE8F + A8_OFF			; enemy idx pending blood splat, $ff = none
status_ms_l	= $CE90 + A8_OFF			; status HUD remaining ms
status_ms_h	= $CE91 + A8_OFF
door_i0		= $CE92 + A8_OFF			; room door slice start
door_i1		= $CE93 + A8_OFF			; exclusive end
sw_match	= $CE94 + A8_OFF			; cooked door/enable-tag id while unlocking/arming/unhiding
; $CE95–$CEAC is atk_kind (ENEMY_MAX). Do not slide en_pain_i.
atk_kind	= $CE95 + A8_OFF			; ENEMY_MAX: 0 melee, 1 missile
en_pain_i	= $CEAD + A8_OFF			; ENEMY_MAX: pain/death variant index
!if atk_kind + ENEMY_MAX != en_pain_i {
	!error "atk_kind must fill the hole under en_pain_i"
}
have_keys	= $CEC5 + A8_OFF			; HAVE_YELLOW / HAVE_BLUE / HAVE_RED
pu_kind		= $CEC6 + A8_OFF			; 0 or TH_RADSUIT
pu_ms_l		= $CEC7 + A8_OFF
pu_ms_h		= $CEC8 + A8_OFF
fx_oxl		= $CEC9 + A8_OFF			; world origin 8.8 (same as rocket)
fx_oyl		= $CECA + A8_OFF
fx_ozl		= $CECB + A8_OFF
fx_ox		= $CECC + A8_OFF
fx_oy		= $CECD + A8_OFF
fx_oz		= $CECE + A8_OFF
sample_ms_chk	= $CECF + A8_OFF			; shadow of sample_ms (init_irq); tripwire restore
spd_trip	= $CED0 + A8_OFF			; sample_ms corruption count (IRQ .top)
; Rocket SoA — 4 slots × 20 bytes, $CED1–$CF20
gr_on		= $CED1 + A8_OFF
gr_owner	= $CED5 + A8_OFF
gr_flags	= $CED9 + A8_OFF
gr_acc		= $CEDD + A8_OFF
gr_xl		= $CEE1 + A8_OFF
gr_xh		= $CEE5 + A8_OFF
gr_yl		= $CEE9 + A8_OFF
gr_yh		= $CEED + A8_OFF
gr_zl		= $CEF1 + A8_OFF
gr_zh		= $CEF5 + A8_OFF
gr_vxl		= $CEF9 + A8_OFF
gr_vxh		= $CEFD + A8_OFF
gr_vyl		= $CF01 + A8_OFF
gr_vyh		= $CF05 + A8_OFF
gr_vzl		= $CF09 + A8_OFF
gr_vzh		= $CF0D + A8_OFF
; Unused (was the grenade fuse). Life follows; do not slide.
; th_draw_fl is gr_fuse_l[0]: live only inside draw_thing_mesh -> fill_item_verts, cleared after.
; Bits 0-2 facing (x45 deg), bits 6-7 = scale shift (0..3 = 1x 2x 4x 8x). Same layout as th_ori.
th_draw_fl	= $CF11 + A8_OFF
gr_fuse_h	= $CF15 + A8_OFF
gr_life_l	= $CF19 + A8_OFF
gr_life_h	= $CF1D + A8_OFF
hit_dmg		= $CF22 + A8_OFF			; applied damage for the current damage_enemy call
dodge_dx	= $CF23 + A8_OFF			; select_dodge_dir: signed dx toward player
dodge_dz	= $CF24 + A8_OFF			; signed dz toward player
dodge_i		= $CF25 + A8_OFF			; 0..4 probe index, live across enemy_probe_dir
; Timed FX headers: +0 on/phase, +1 skip, +2 ms_l, +3 ms_h
FXH_ON		= 0
FXH_SKIP	= 1
FXH_MS_L	= 2
FXH_MS_H	= 3
FXH_COUNT	= 4
fxh_flash	= $CF2E + A8_OFF
flash_phase	= fxh_flash + FXH_ON	; pistol muzzle: 0 off, 1 yellow, 2 red
flash_skip	= fxh_flash + FXH_SKIP
flash_ms_l	= fxh_flash + FXH_MS_L
flash_ms_h	= fxh_flash + FXH_MS_H
fxh_emuz	= $CF36 + A8_OFF
emuz_on		= fxh_emuz + FXH_ON	; 1 = sprite 6 enabled
emuz_skip	= fxh_emuz + FXH_SKIP
emuz_ms_l	= fxh_emuz + FXH_MS_L
emuz_ms_h	= fxh_emuz + FXH_MS_H
fxh_splat	= $CF3A + A8_OFF
splat_on	= fxh_splat + FXH_ON	; 1 = sprite 7 enabled
splat_skip	= fxh_splat + FXH_SKIP
splat_ms_l	= fxh_splat + FXH_MS_L
splat_ms_h	= fxh_splat + FXH_MS_H
fxh_explode	= $CF3E + A8_OFF
fx_on		= fxh_explode + FXH_ON	; 1 = explosion live
fx_skip		= fxh_explode + FXH_SKIP
fx_ms_l		= fxh_explode + FXH_MS_L
fx_ms_h		= fxh_explode + FXH_MS_H
; Room whose pose banks are currently resident; $ff = none yet.
stream_room	= $CF42 + A8_OFF
; Explosion particle vel — FX_N × vx/vy s8 (integrated at draw)
fx_vx		= $CF43 + A8_OFF			; 24
fx_vy		= $CF5B + A8_OFF			; 24
; Barrel chain ($CF73–$CF79), splat anchor ($CF7B–$CF81). Do not slide splat_src.
barrel_pend	= $CF73 + A8_OFF		; 4 bytes, bit = thing index
barrel_ch_l	= $CF77 + A8_OFF
barrel_ch_h	= $CF78 + A8_OFF
shot_th		= $CF79 + A8_OFF		; hitscan barrel winner, $ff = none
; World-anchored splat ($CF7B–$CF81): re-projected each frame by splat_track.
splat_wx	= $CF7B + A8_OFF			; world int of the hit point
splat_wy	= $CF7C + A8_OFF
splat_wz	= $CF7D + A8_OFF
splat_jx	= $CF7E + A8_OFF			; signed screen-px jitter added after projection
splat_jy	= $CF7F + A8_OFF
splat_anch	= $CF80 + A8_OFF			; 1 = world-anchored, 0 = fixed in screen space
splat_trk	= $CF81 + A8_OFF			; 1 = splat_track re-placing (start_world_spr must not re-arm)
splat_src	= $CF83 + A8_OFF			; clipped splat rect
!if barrel_pend != fx_vy + FX_N {
	!error "barrel_pend must follow fx_vy"
}
!if shot_th >= splat_src {
	!error "barrel chain state overlaps splat_src"
}
; Evicted from KERNAL ZP ($90–$bf / SETNAM $b7–$bc). Abs OK — not (ptr),y.
wish_dx		= $CF85 + A8_OFF			; signed move intent X
wish_dz		= $CF86 + A8_OFF
wish_dxh	= $CF87 + A8_OFF			; wish 8.8 high
wish_dzh	= $CF88 + A8_OFF
save_xh		= $CF89 + A8_OFF
save_zh		= $CF8A + A8_OFF
save_xl		= $CF8B + A8_OFF
save_zl		= $CF8C + A8_OFF
col_x		= $CF8D + A8_OFF			; collision test point
col_z		= $CF8E + A8_OFF
col_y		= $CF8F + A8_OFF
obj_i		= $CF90 + A8_OFF
face_bits	= $CF91 + A8_OFF			; which box faces visible
box_x		= $CF92 + A8_OFF			; box under test (line/point/draw). A nested load replaces it.
box_y		= $CF93 + A8_OFF
box_z		= $CF94 + A8_OFF
box_sx		= $CF95 + A8_OFF
box_sy		= $CF96 + A8_OFF
box_sz		= $CF97 + A8_OFF
msg_off		= $CF98 + A8_OFF			; offset into map_text
vel_ms		= $CF99 + A8_OFF			; hold duration ms (lo)
vel_msh		= $CF9A + A8_OFF
turn_acc_l	= $CF9B + A8_OFF
turn_acc_h	= $CF9C + A8_OFF
dt_msh		= $CF9D + A8_OFF			; frame dt milliseconds (hi)
inv_l		= $CF9E + A8_OFF			; (FOCAL<<16)/(z>>k) lo, mesh project
inv_h		= $CF9F + A8_OFF
inv_k		= $CFA0 + A8_OFF
mesh_vmask	= $CFA1 + A8_OFF
mesh_nwork	= $CFA2 + A8_OFF
random8		= $CFA3 + A8_OFF
scale_s		= $CFA4 + A8_OFF
fn_lx		= $CFA5 + A8_OFF			; frustum inward normals (XZ)
fn_lz		= $CFA6 + A8_OFF
fn_rx		= $CFA7 + A8_OFF
fn_rz		= $CFA8 + A8_OFF
fn_fx		= $CFA9 + A8_OFF
fn_fz		= $CFAA + A8_OFF
pv0		= $CFAB + A8_OFF			; glyph / ramp / door fill
pv1		= $CFAC + A8_OFF
pv2		= $CFAD + A8_OFF
pv3		= $CFAE + A8_OFF
pv4		= $CFAF + A8_OFF
col_bg		= $CFB0 + A8_OFF			; active room paper: Atari colour byte (editor-made) → COLPF0
doom_anim_ph	= $CFB1 + A8_OFF			; flips each ANIM_MS; 0 = fine enemies hold this step
blast_room	= $CFB2 + A8_OFF			; room of the blast origin: rkt_place / barrel_place; splash and barrel chain skip other rooms
; $CFB5 was col_wpn ($CFB2 was col_line)
palette_room	= $CFB3 + A8_OFF			; last room_idx palette ($ff = none)
sfx_ch		= $CFB6 + A8_OFF			; current channel 0..2
sfx_id		= $CFB7 + A8_OFF			; sound id / freq scratch
sample_ms	= $CFB8 + A8_OFF			; PAL 20 / NTSC 17 — set at init
ps_save_x	= $CFB9 + A8_OFF
ps_save_y	= $CFBA + A8_OFF
door_blk	= $CFBB + A8_OFF			; bit0 X slide blocked, bit1 Z
mv0_xl		= $CFBC + A8_OFF			; cam 8.8 at start of apply_move_world
mv0_xh		= $CFBD + A8_OFF
mv0_zl		= $CFBE + A8_OFF
mv0_zh		= $CFBF + A8_OFF
; $CFC0+ free
ai_code_lo	= $CFC0 + A8_OFF			; runtime code base while patching a bank
ai_code_hi	= $CFC1 + A8_OFF
ai_delta_lo	= $CFC2 + A8_OFF			; runtime code base - AI_LINK_BASE
ai_delta_hi	= $CFC3 + A8_OFF
ai_reloc_nlo	= $CFC4 + A8_OFF
ai_reloc_nhi	= $CFC5 + A8_OFF
ai_map_nlo	= $CFC6 + A8_OFF
ai_map_nhi	= $CFC7 + A8_OFF
ai_pose_lo	= $CFC8 + A8_OFF
ai_pose_hi	= $CFC9 + A8_OFF
ai_cmd		= $CFCA + A8_OFF
ai_field	= $CFCB + A8_OFF
rune_taken	= $CFCC + A8_OFF			; reserved quicksave byte; do not drop
; Bump crack — one door mesh, fixed until the timer elapses. Do not slide rune_taken.
CRACK_MS	= 1000
CRACK_BORN	= 1			; bit0 armed this frame (switch / transit may drop it)
CRACK_HOLD	= 2			; bit1 suppress until this contact ends
crack_ms_l	= $CFCD + A8_OFF		; 0 = no mark
crack_ms_h	= $CFCE + A8_OFF
crack_x		= $CFCF + A8_OFF		; hi X then Z, index by axis
crack_z		= $CFD0 + A8_OFF
crack_xl	= $CFD1 + A8_OFF		; lo X then Z
crack_zl	= $CFD2 + A8_OFF
crack_y		= $CFD3 + A8_OFF		; feet / crate bottom
crack_face	= $CFD4 + A8_OFF		; FACE_*
crack_room	= $CFD5 + A8_OFF
crack_flags	= $CFD6 + A8_OFF
scan_best_i	= $CFDB + A8_OFF		; scan_shoot_*: best thing / switch index ($ff none)
scan_best_z	= $CFDC + A8_OFF		; its CAM_ZH
elev_ride_i	= $CFDE + A8_OFF		; elev SoA index while carrying riders
elev_ride_dy	= $CFDF + A8_OFF		; signed Y step ($01 / $ff, or reseat delta)
elev_ride_top	= $CFE0 + A8_OFF		; surface those riders must match
elev_y		= $CFE2 + A8_OFF		; MAP_NELEVS (≤8); page $CF so ,x stays in-page
elev_match	= $CFEA + A8_OFF		; tag group while fanning elev_activate
elev_hits	= $CFEB + A8_OFF		; cars that started moving this fan-out
; Unhide timers. Tag 0 = idle. Charset A is $D000. Do not slide.
UNHIDE_MAX	= 4
uh_tag		= $CFEC + A8_OFF		; cooked door tag
uh_lo		= $CFF0 + A8_OFF		; remaining ms
uh_hi		= $CFF4 + A8_OFF
uh_hide		= $CFF8 + A8_OFF		; door_hide_tag: 1 = set DOOR_HIDDEN
ability_cur	= $CFF9 + A8_OFF		; ABIL_*
space_held	= $CFFA + A8_OFF		; 1 = space still down; one toggle per press
jump_held	= $CFFB + A8_OFF		; 1 = fire still down in jump mode
jump_on		= $CFFC + A8_OFF		; 0 none, 1 vertical only, 2 with XZ (while airborne)
jump_yaw	= $CFFD + A8_OFF		; takeoff heading for the arc
fall_vf		= $CFFE + A8_OFF		; fall_v fraction (8.16 low byte); map_grav is 1/4 unit/tick^2 steps
; $CFFF reserved.
!if uh_tag != elev_hits + 1 {
	!error "uh_tag must follow elev_hits"
}
!if uh_tag + UNHIDE_MAX != uh_lo {
	!error "uh_lo must follow uh_tag"
}
!if uh_lo + UNHIDE_MAX != uh_hi {
	!error "uh_hi must follow uh_lo"
}
!if uh_hi + UNHIDE_MAX != uh_hide {
	!error "uh_hide must follow uh_hi"
}
HAVE_YELLOW	= 1
HAVE_BLUE	= 2
HAVE_RED	= 4
POWERUP_MS	= 45000
