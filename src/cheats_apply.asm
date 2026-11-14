; Cheat requests applied from the main loop (apply_cheats) and the status line.
; Assembled into the bank-0 code zone (nebula.asm): runs only with PORTB_PLAY.
; The keycode FSM (check_cheats) stays in cheats.asm, segment B, for the VBI.
!zone cheats_apply

cheat_msg_on	!text "godmode on",0
cheat_msg_off	!text "godmode off",0
cheat_msg_bit	!text "+1000 bits",0
cheat_msg_map	!text "change map",0

; ---------------------------------------------------------------------------
; Main. cheat_req is IRQ-owned; copy it out under SEI.
; ---------------------------------------------------------------------------
apply_cheats
	php
	sei
	lda cheat_req
	beq .ac_none
	ldy cheat_map_latch
	pha
	lda #0
	sta cheat_req
	pla
	plp
	cmp #CHEAT_REQ_GOD
	beq apply_god
	cmp #CHEAT_REQ_BIT
	beq apply_bit
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

apply_bit
	lda #<1000
	ldx #>1000
	jsr bits_add
	jsr hud_bits
	lda #<cheat_msg_bit
	ldy #>cheat_msg_bit
	jsr cheat_show
	lda #SOUND_ITEMUP
	jmp play_sound

; Y = level 1..26 (map letter). Out of range = ignored. Message after
; play_up2 (inside restart).
apply_map
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
