; Nebula Skip — portal-room maps + enemy poses loaded from disk


!cpu 6502

!to "game.prg", cbm

!source "build_flags.asm"

!source "mem.asm"
!source "zp.asm"
!source "map_counts.asm"
!source "mapacc.asm"
!if  ENEMY_PTR_N != ENEMY_NTYPES {
	!error "mem.asm ENEMY_PTR_N must equal ENEMY_NTYPES"
}

*= LOCODE_BASE
mod_doom
start
	sei
	cld
	ldx #$ff
	txs

	lda #PORTB_MAIN				; bit 0 clear: RAM under the OS
	sta $d301
	jsr load_game_segments			; segments B, C, D (boot loaded A)
	jsr a8_bind_tabs
	lda #PORTB_PLAY				; bank 0 over $4000-$7FFF from here on
	sta portb_cur
	sta $d301


	lda #0
	sta load_in_play
	jsr cheat_init
	lda $ba
	bne +
	lda #8
+
	sta load_device
	jsr install_reboot_stub
	lda #START_LEVEL
	sta level_num
	jsr LoadLevel
	bcc .start_ok
	jmp load_fail_hang
.start_ok
	jsr play_up1
	jsr init_weapon
	jsr play_up2
	jsr enter_card

main
	jsr poll_quick_keys			; Shift-S save / Shift-L load; view stays blank until the next frame
	cld
!if  PROFILE = 1 {
	jsr prof_reset_frame
} else {
	lda #$ff
	sta mesh_vmask
}
	jsr wait_draw_free
	jsr clear_draw
!if  PROFILE = 1 {
	ldy #PROF_CLEAR
	jsr prof_add_bucket
}
	jsr draw_world
	jsr draw_enemies
	jsr draw_rockets
	jsr draw_explosion

	jsr stamp_view


	lda draw_buf
	sta show_buf
	jsr apply_show
	lda den_arm
	cmp #1				; hold until this frame is published
	bne .den_pub
	lda #2
	sta den_arm
.den_pub
	jsr calc_frame_dt
	jsr update_hurt_flash
	jsr tick_crack
	jsr update_powerup
	jsr update_item_spin

	lda draw_buf
	eor #1
	sta draw_buf
	jsr set_draw_ptrs
	jsr read_input
	jsr apply_cheats
	jsr update_weapon
	jsr apply_move_world
	jsr maybe_room_palette
	jsr maybe_stream_room			; after movement, before the next draw
	jsr try_proximity
	jsr proc_update
	jsr update_floor
	jsr update_fall
	jsr update_rockets
	jsr update_barrel_chain
	jsr update_status
	jsr update_triggers
	jsr enemies_update
!if  PROFILE = 1 {
	ldy #PROF_UPDATE
	jsr prof_add_bucket
}
	jsr hud_print
	jmp main

mod_vic

!source "a8vic.asm"

mod_irq

!source "a8irq.asm"

mod_profil
!source "profil.asm"
mod_math
!source "math.asm"
mod_util
!source "util.asm"
mod_line

!source "a8line.asm"

mod_rocket
!source "rocket.asm"
mod_playsound
!source "playsound.asm"
mod_pcsounds
!source "pcsounds.asm"
mod_a8stamp
!source "a8stamp.asm"

; LoadPrg and its helpers must be in A: start loads segments B, C and D with it.
mod_a8sio
!source "a8sio.asm"

; Item / door line meshes (tools/genitems.py). Pure data read at draw time from
; main RAM, so it lives in A rather than the full bank-0 static block.
mod_item_mesh
!source "item_mesh.asm"
mod_item_xf
!source "item_xf.asm"

seg_a_end = *
!if seg_a_end > $4000 {
	!error "GAME segment A runs into the bitmaps; end=$", seg_a_end
}

; --- Bank 0 static data: loaded once at boot, read only with PORTB_PLAY.
*= STATIC_BASE
mod_weapon_spr
!source "weapon_spr.asm"
mod_splat_spr
!source "splat_spr.asm"
mod_enemy_muzzle
!source "enemy_muzzle.asm"
static_end = *
!if static_end > STATIC_END {
	!error "static data runs into QS_OVL; end=$", static_end
}

; --- Segment B: everything that runs with the OS ROM on stays below $C000.
*= $8000
seg_b_start = *
mod_hud
!source "hud.asm"
mod_world
!source "world.asm"
mod_enemy
!source "enemy.asm"
mod_cheats
!source "cheats.asm"
mod_loader
!source "loader.asm"

!source "a8tabs.asm"
!source "a8reboot.asm"
seg_b_end = *
!if seg_b_end > A8_OSPAGE {
	!error "GAME segment B runs into the OS page snapshot; end=$", seg_b_end
}

; --- Bank 0 code zone: main-loop-only modules. They run with PORTB_PLAY, so no
; trampolines. Never call these from NMI/DLI, with the OS on, from a screen leaf
; or before boot has written BANK0. Mutable !byte cells in here keep their value
; across a reboot (bank 0 is loaded once), so re-initialise them at start.
*= CODE0_BASE
mod_weapon
!source "weapon.asm"
mod_process
!source "process.asm"
mod_elevator
!source "elevator.asm"
mod_cheats_apply
!source "cheats_apply.asm"
code0_end = *
!if code0_end > CODE0_END {
	!error "bank-0 code zone runs into the static data; end=$", code0_end
}

; --- Segment C: never executed or read while PORTB = $FF (OS ROM on).
*= $C000
seg_c_start = *
mod_cube
!source "cube.asm"
mod_fx
!source "fx.asm"
seg_c_end = *
!if seg_c_end > $D000 {
	!error "GAME segment C runs into I/O; end=$", seg_c_end
}

; --- Segment D
*= $E000
seg_d_start = *
mod_door
!source "door.asm"
mod_mesh
!source "mesh.asm"
seg_d_end = *
!if seg_d_end + GAME_DL_N > $F000 OR seg_d_end > GAME_DL_STAGE {
	!error "GAME segment D runs into GAME_DL_STAGE or the LUTs; end=$", seg_d_end
}

!source "map_bss.asm"

!if  PROFILE = 1 {
casc_snap
	!fill 4, 0
prof_dt
	!fill 4, 0
prof_cy
	!fill PROF_NBUCKET * 4, 0
; Per-frame vertex totals (R/P/K stages)
nv_cnt
nv_rot
	!fill 2, 0
nv_proj
	!fill 2, 0
nv_clip
	!fill 2, 0
}

; The heap is bank 0 [DYN_BASE, HEAP_LIM): no GAME code lives there. E1M1 map is 2373.
!if  DYN_BASE + LEVEL_PREFIX + 2373 >= HEAP_LIM {
	!error "bank 0 heap too small for e1m1"
}

