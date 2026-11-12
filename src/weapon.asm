; First-person view-model: the pistol body and its muzzle flash, drawn by
; a8stamp. The only weapon. World effects (enemy muzzle, splat) share the
; timed-FX headers below.
!zone weapon

POSE_IDLE = 0
POSE_RECOIL = 1

PISTOL_RECOIL_N = 2			; −4 for 300 ms, then −6 for 160 ms

WS_EMUZ		= 0
WS_SPLAT	= 1

; LOD 0..2 per slot (emuz then splat)
ws_spr_lo
	!byte <spr_emuz_0, <spr_emuz_1, <spr_emuz_2
	!byte <spr_splat_0, <spr_splat_1, <spr_splat_2
ws_spr_hi
	!byte >spr_emuz_0, >spr_emuz_1, >spr_emuz_2
	!byte >spr_splat_0, >spr_splat_1, >spr_splat_2
ws_msb
	!byte EMUZ_MSB, SPLAT_MSB
ws_ms_l
	!byte <EMUZ_MS, <SPLAT_MS
ws_ms_h
	!byte >EMUZ_MS, >SPLAT_MS
ws_hdr_lo
	!byte <fxh_emuz, <fxh_splat
ws_hdr_hi
	!byte >fxh_emuz, >fxh_splat
ws_vx_lo
	!byte <emuz_vx, <splat_vx
ws_vx_hi
	!byte >emuz_vx, >splat_vx
ws_vy_lo
	!byte <emuz_vy, <splat_vy
ws_vy_hi
	!byte >emuz_vy, >splat_vy
ws_col_lo
	!byte <emuz_col, <splat_col
ws_col_hi
	!byte >emuz_col, >splat_col
ws_xmsb_lo
	!byte <emuz_xmsb, <splat_xmsb
ws_xmsb_hi
	!byte >emuz_xmsb, >splat_xmsb
ws_snd
	!byte SOUND_FIREBALL, 0
ws_colsrc
	!byte 0, 1			; 0 = set COL_FX, 1 = leave splat_col

fxh_lo
	!byte <fxh_flash, <fxh_emuz, <fxh_splat, <fxh_explode
fxh_hi
	!byte >fxh_flash, >fxh_emuz, >fxh_splat, >fxh_explode
fx_exp_lo
	!byte <flash_expired, <emuz_expired, <splat_expired, <fx_zero_header
fx_exp_hi
	!byte >flash_expired, >emuz_expired, >splat_expired, >fx_zero_header

; SquareDoom pistol: kick up 4 for 300 ms with the flash, then 6 for 160 ms.
recoil_pist_y
	!byte WPN_Y_PISTIDLE - 4, WPN_Y_PISTIDLE - 6
recoil_pist_ms_lo
	!byte <300, <160
recoil_pist_ms_hi
	!byte >300, >160

; ------------------------------------------------------------------
; Flash and world-FX state. Does not touch HP, ammo, or the loadout.
init_weapon_hw
	ldx #0
.iw_fxh
	lda fxh_lo,x
	sta fx_ptr
	lda fxh_hi,x
	sta fx_ptr+1
	lda #0
	ldy #FXH_ON
	sta (fx_ptr),y
	iny
	sta (fx_ptr),y
	iny
	sta (fx_ptr),y
	iny
	sta (fx_ptr),y
	inx
	cpx #FXH_COUNT
	bcc .iw_fxh
	sta wpn_bob_ph
	sta emuz_xmsb
	sta emuz_vx
	sta emuz_vy
	sta emuz_col
	sta splat_xmsb
	sta splat_vx
	sta splat_vy
	sta splat_col
	lda #$ff
	sta emuz_pending
	sta bite_splat_i
	lda #0
	sta fire_rpt_l
	sta fire_rpt_h
	sta wpn_pose
	sta anim_step
	sta in_fire
	sta key_fire
	rts

; First start: hardware + starting inventory.
init_weapon
	jsr init_weapon_hw
	jsr init_rockets
	jmp reset_loadout

reset_loadout
	lda #AMMO_BULLETS_START
	sta ammo_bullets
	lda #PLAYER_HP_START
	sta player_hp
	lda #PLAYER_ARMOUR_START
	sta player_armour
	sta combat_armor
	lda #0
	sta have_keys
	sta have_pack
	sta pu_kind
	sta pu_ms_l
	sta pu_ms_h
	; fall through

; Pistol up: idle pose, flash cleared. Quickload and a fresh start land here.
ready_weapon
	lda #0
	sta fire_rpt_l
	sta fire_rpt_h
	sta flash_phase
	sta flash_skip
	sta flash_ms_l
	sta flash_ms_h
	sta wpn_pose
	sta anim_step
	; fall through

setup_weapon
	lda #WPN_Y_PISTIDLE
	sta wpn_y
	rts

; A = src lo, Y = src hi. Both keep the mode-E pointer (no unpack).
blit_world
	ldx ws_slot
	beq .bw_emuz
	sta splat_src
	sty splat_src+1
	rts
.bw_emuz
	sta emuz_src
	sty emuz_src+1
	rts

start_flash
	lda #1
	sta flash_phase
	sta flash_skip
	lda #<FLASH_YEL_MS
	sta flash_ms_l
	lda #>FLASH_YEL_MS
	sta flash_ms_h
	rts

; ------------------------------------------------------------------
; pin_room_gear — no-combat room: force ABIL_JUMP. C=1 if the room is no-combat.
; Called from set_room_idx (and world_init) so the swap lands on the room change
; itself, not a frame later in update_weapon: stamp_view would draw the gun once
; in between. Clobbers A, X, Y.
pin_room_gear
	ldy room_idx
	+lda_my room_bg
	and #ROOM_NOCOMBAT
	beq .prg_no
	lda ability_cur
	cmp #ABIL_JUMP
	beq .prg_yes
	lda #ABIL_JUMP
	sta ability_cur
	lda #1
	sta jump_held			; a held fire button must not take off on entry
	jsr hud_ability
.prg_yes
	sec
	rts
.prg_no
	clc
	rts

; ------------------------------------------------------------------
update_weapon
	jsr pin_room_gear		; no-combat room: jump is pinned (set_room_idx does the
	bcc .uw_abk			; swap on entry), so swallow the toggle.
	lda #0				; Nothing is cached; leaving the room leaves jump.
	sta key_ability
.uw_abk
	lda key_ability
	beq .uw_ab
	lda ability_cur
	eor #1
	sta ability_cur
	lda #0
	sta jump_held
	jsr hud_ability
.uw_ab
	jsr tick_all_fx
	jsr tick_anim

	lda fire_rpt_l
	ora fire_rpt_h
	beq .uw_chk
	sec
	lda fire_rpt_l
	sbc dt_ms
	sta fire_rpt_l
	lda fire_rpt_h
	sbc dt_msh
	sta fire_rpt_h
	bcs .uw_chk
	lda #0
	sta fire_rpt_l
	sta fire_rpt_h
.uw_chk
	lda ability_cur
	cmp #ABIL_JUMP
	bne .uw_fire
	lda key_fire			; jump mode: press edge, weapon stays idle
	beq .uw_jrel
	lda jump_held
	bne .uw_up
	lda #1
	sta jump_held
	jsr do_jump
	jmp .uw_up
.uw_jrel
	sta jump_held			; A = 0
	beq .uw_up
.uw_fire
	lda key_fire
	beq .uw_up
	lda fire_rpt_l
	ora fire_rpt_h
	bne .uw_up
	lda wpn_pose
	bne .uw_up
	jsr try_spend_ammo
	bcc .uw_up
	jsr hud_ammo
	jsr fire_shot
	lda #<PISTOL_FIRE_MS
	sta fire_rpt_l
	lda #>PISTOL_FIRE_MS
	sta fire_rpt_h
.uw_up
	jmp tick_wpn_bob

; Idle + a move hold: phase += dt>>2, wrapped to the positive half-sine.
; 128 steps × 4 ms = 512 ms per dip. Fire, falling, or no hold zeros the
; phase so the stamp adds nothing.
tick_wpn_bob
	lda wpn_pose
	bne .tbb_stop
	lda pl_falling
	bne .tbb_stop
	ldy #7
	lda #0
.tbb_hold
	ora hold_fwd,y
	dey
	bpl .tbb_hold
	tax				; dey cleared Z; test the OR
	beq .tbb_stop
	lda dt_ms
	sta wpn_tmp0
	lda dt_msh
	lsr
	ror wpn_tmp0
	lsr
	ror wpn_tmp0
	lda wpn_bob_ph
	clc
	adc wpn_tmp0
	and #$7f
	sta wpn_bob_ph
	rts
.tbb_stop
	lda #0
	sta wpn_bob_ph
	rts

; Ammo already spent.
fire_shot
	lda #1
	sta gunshot_wake
	lda #SOUND_PISTOL
	jsr play_sound
	jsr pistol_hitscan
	jsr start_flash
	jmp start_recoil

; C=1 spent (or free), C=0 cannot fire
try_spend_ammo
!if  INF_AMMO = 1 {
	sec
	rts
}
	lda ammo_bullets
	beq .ts_no
	dec ammo_bullets
	sec
	rts
.ts_no
	clc
	rts

wpn_to_idle
	lda #POSE_IDLE
	sta wpn_pose
	lda #0
	sta anim_step
	lda #WPN_Y_PISTIDLE
	sta wpn_y
	rts

start_recoil
	lda #POSE_RECOIL
	sta wpn_pose
	lda #0
	sta anim_step
	; fall through

recoil_apply_step
	ldx anim_step
	cpx #PISTOL_RECOIL_N
	bcc .ras_ok
	jmp wpn_to_idle
.ras_ok
	lda recoil_pist_y,x
	sta wpn_y
	lda recoil_pist_ms_lo,x
	sta anim_ms_l
	lda recoil_pist_ms_hi,x
	sta anim_ms_h
	rts

; fx_ptr → 4-byte header. C=1 expired this frame (does not clear +0).
tick_fx
	ldy #FXH_ON
	lda (fx_ptr),y
	beq .tf_idle
	ldy #FXH_SKIP
	lda (fx_ptr),y
	beq .tf_sub
	lda #0
	sta (fx_ptr),y
	clc
	rts
.tf_sub
	ldy #FXH_MS_L
	sec
	lda (fx_ptr),y
	sbc dt_ms
	sta (fx_ptr),y
	iny
	lda (fx_ptr),y
	sbc dt_msh
	sta (fx_ptr),y
	bcc .tf_exp
	dey
	ora (fx_ptr),y
	bne .tf_live
.tf_exp
	sec
	rts
.tf_live
	clc
	rts
.tf_idle
	clc
	rts

tick_all_fx
	ldx #0
.ta_lp
	lda fxh_lo,x
	sta fx_ptr
	lda fxh_hi,x
	sta fx_ptr+1
	jsr tick_fx
	bcc .ta_n
	lda fx_exp_lo,x
	sta rot0
	lda fx_exp_hi,x
	sta rot1
	jsr .ta_go
.ta_n
	inx
	cpx #FXH_COUNT
	bcc .ta_lp
	rts
.ta_go
	jmp (rot0)

fx_zero_header
	lda #0
	ldy #FXH_ON
	sta (fx_ptr),y
	iny
	sta (fx_ptr),y
	iny
	sta (fx_ptr),y
	iny
	sta (fx_ptr),y
	rts

; Muzzle flash: yellow → red, else off. Preserves X.
flash_expired
	ldy #FXH_ON
	lda (fx_ptr),y
	cmp #1
	bne fx_zero_header
	lda #2
	sta (fx_ptr),y
	iny
	lda #1
	sta (fx_ptr),y
	iny
	lda #<FLASH_RED_MS
	sta (fx_ptr),y
	iny
	lda #>FLASH_RED_MS
	sta (fx_ptr),y
	rts

emuz_expired
	jsr fx_zero_header
	lda #0
	sta emuz_xmsb
	rts

splat_expired
	jsr fx_zero_header
	lda #0
	sta splat_xmsb
	rts

; A = value, X = slot. Store via ws_*_lo/hi pointer tables. Clobbers fx_ptr, Y.
!macro ws_sta .lo, .hi {
	pha
	lda .lo,x
	sta fx_ptr
	lda .hi,x
	sta fx_ptr+1
	pla
	ldy #0
	sta (fx_ptr),y
}

; A = tip viewport sx, Y = tip viewport sy. Depth = rot1 (CAM_ZH of tip vert).
start_enemy_muzzle
	pha
	tya
	pha
	lda rot1
	ldx #WS_EMUZ
	jmp start_world_spr

; A = tip viewport sx, Y = tip viewport sy, X = depth (EMUZ_Z0/Z1 bands).
start_splat
	pha
	tya
	pha
	txa
	ldx #WS_SPLAT
start_world_spr
	pha				; z
	stx ws_slot			; X is slot; lod calc reuses X
	txa
	tay				; Y = slot
	pla				; A = z
	cpy #0
	bne .sws_zok
	cmp #0
	bmi .sws_far
.sws_zok
	ldx #0
	cmp #EMUZ_Z0
	bcc .sws_lod
	inx
	cmp #EMUZ_Z1
	bcc .sws_lod
.sws_far
	ldx #2
.sws_lod
	lda ws_slot
	asl
	clc
	adc ws_slot			; slot*3
	sta wpn_tmp0
	txa
	clc
	adc wpn_tmp0			; + lod
	tax
	lda ws_spr_lo,x
	ldy ws_spr_hi,x
	jsr blit_world
	ldx ws_slot
	pla				; sy
	clc
	adc #VIEW_SPR_Y0 - EMUZ_OY
	+ws_sta ws_vy_lo, ws_vy_hi
	pla				; sx
	clc
	adc #VIEW_SPR_X0 - EMUZ_OX
	pha
	lda #0
	bcc .sws_xlo
	lda ws_msb,x
.sws_xlo
	+ws_sta ws_xmsb_lo, ws_xmsb_hi
	pla
	+ws_sta ws_vx_lo, ws_vx_hi
	lda ws_colsrc,x
	bne .sws_nocol
	lda #COL_FX
	+ws_sta ws_col_lo, ws_col_hi
.sws_nocol
	lda splat_trk			; splat_track re-place: keep the running timer
	bne .sws_end
	lda ws_snd,x
	beq .sws_arm
	lda ws_hdr_lo,x
	sta fx_ptr
	lda ws_hdr_hi,x
	sta fx_ptr+1
	ldy #FXH_ON
	lda (fx_ptr),y
	bne .sws_arm
	lda ws_snd,x
	stx wpn_tmp0
	jsr play_sound
	ldx wpn_tmp0
.sws_arm
	lda ws_hdr_lo,x
	sta fx_ptr
	lda ws_hdr_hi,x
	sta fx_ptr+1
	lda #1
	ldy #FXH_ON
	sta (fx_ptr),y
	iny
	sta (fx_ptr),y
	lda ws_ms_l,x
	ldy #FXH_MS_L
	sta (fx_ptr),y
	lda ws_ms_h,x
	iny
	sta (fx_ptr),y
.sws_end
	rts

; Per-frame re-place of a world-anchored splat (from stamp_view, current
; camera). C=1: splat_vx/vy/xmsb/src valid (or the splat is screen-fixed).
; C=0: behind the camera or outside the viewport, so skip the stamp. The
; projection clamps to the viewport, so an edge value means off-screen.
; splat_trk makes start_world_spr return before it re-arms the timer.
splat_track
	lda splat_anch
	bne .st_go
	sec
	rts
.st_go
	jsr load_view_trig
	ldx #2
.st_cp
	lda splat_wx,x
	sta ent_wx,x
	dex
	bpl .st_cp
	jsr xform_ent_view
	jsr project_cam0_screen
	bcc .st_no
	beq .st_no
	cmp #191
	bcs .st_no
	adc splat_jx			; C=0; sum >= 192 also catches negative
	cmp #192
	bcs .st_no
	tax
	tya
	beq .st_no
	cmp #127
	bcs .st_no
	adc splat_jy
	cmp #128
	bcs .st_no
	tay
	txa
	ldx CAM_ZH
	inc splat_trk
	jsr start_splat
	dec splat_trk
	sec
	rts
.st_no
	clc
	rts

; ent_wx/wy/wz = hit point. A = jitter centre sx (0 = the point's own
; projection), Y = centre sy. splat_col set. Anchors the point in world space;
; splat_jx/jy keep jittered centre minus the projection, so the first frame
; lands on the centre whatever the integer rounding of the point.
splat_spawn
	pha
	tya
	pha
	jsr xform_ent_view
	jsr project_cam0_screen
	bcc .ss_no
	sta splat_jx
	sty splat_jy
	pla
	tay
	pla
	bne .ss_ctr
	lda splat_jx
	ldy splat_jy
.ss_ctr
	jsr splat_aim_jitter
	sta rot2
	sec
	sbc splat_jx
	sta splat_jx
	tya
	sec
	sbc splat_jy
	sta splat_jy
	ldx #2
.ss_cp
	lda ent_wx,x
	sta splat_wx,x
	dex
	bpl .ss_cp
	lda #1
	sta splat_anch
	ldx CAM_ZH			; view depth → EMUZ_Z* LOD
	lda rot2
	jmp start_splat
.ss_no
	pla
	pla
	rts

; Recoil kick. Runs while the pose is POSE_RECOIL.
tick_anim
	lda wpn_pose
	cmp #POSE_RECOIL
	bne .ta_rts
	sec
	lda anim_ms_l
	sbc dt_ms
	sta anim_ms_l
	lda anim_ms_h
	sbc dt_msh
	sta anim_ms_h
	bcc .ta_exp
	ora anim_ms_l
	bne .ta_rts
.ta_exp
	inc anim_step
	jmp recoil_apply_step
.ta_rts
	rts
