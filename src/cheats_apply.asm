; Cheat requests applied from the main loop (apply_cheats) and the status line.
; Assembled into the bank-0 code zone (nebula.asm): runs only with PORTB_PLAY.
; The keycode FSM (check_cheats) stays in cheats.asm, segment B, for the VBI.
!zone cheats_apply

cheat_msg_on	!text "godmode on",0
cheat_msg_off	!text "godmode off",0
cheat_msg_kfa	!text "keys, full ammo",0
cheat_msg_map	!text "change map",0

; ---------------------------------------------------------------------------
; Main. cheat_req is IRQ-owned; copy it out under SEI.
; ---------------------------------------------------------------------------
apply_cheats
	php
	sei
	lda cheat_req
	beq .ac_none
	ldx cheat_ep_latch
	ldy cheat_map_latch
	pha
	lda #0
	sta cheat_req
	pla
	plp
	cmp #CHEAT_REQ_GOD
	beq apply_god
	cmp #CHEAT_REQ_KFA
	beq apply_kfa
	cmp #CHEAT_REQ_MAP
	beq apply_map
	rts
.ac_none
	plp
	rts

apply_god
	lda god_mode
	eor #1
	sta god_mode
	beq .ag_off
	lda #<cheat_msg_on
	ldy #>cheat_msg_on
	jmp .ag_msg
.ag_off
	lda #<cheat_msg_off
	ldy #>cheat_msg_off
.ag_msg
	jsr cheat_show
	lda #SOUND_ITEMUP
	jmp play_sound

apply_kfa
	lda #AMMO_BULLETS_MAX
	sta ammo_bullets
	lda #PLAYER_ARMOUR_MAX
	sta player_armour
	lda #1
	sta combat_armor
	lda have_keys
	ora #HAVE_YELLOW | HAVE_BLUE | HAVE_RED
	sta have_keys
	jsr hud_keys
	jsr hud_ammo
	lda #<cheat_msg_kfa
	ldy #>cheat_msg_kfa
	jsr cheat_show
	lda #SOUND_WPNUP
	jmp play_sound

; X = episode digit, Y = map digit. Message after play_up2 (inside restart).
apply_map
	cpx #1
	bne .am_rts
	cpy #1
	bcc .am_rts
	cpy #MAP_NLEVELS + 1
	bcs .am_rts
	sty level_num
	jsr restart_level
	bcs .am_fail
	lda #<cheat_msg_map
	ldy #>cheat_msg_map
	jmp cheat_show
.am_fail
	jmp episode_done
.am_rts
	rts

; A = lo, Y = hi. Status row, STATUS_MS.
cheat_show
	sta src_ptr
	sty src_ptr+1
	jsr hud_msg_blank
	jsr hud_msg_center
	lda #<STATUS_MS
	sta status_ms_l
	lda #>STATUS_MS
	sta status_ms_h
	rts
