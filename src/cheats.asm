; Cheat codes. C64: next CIA1 matrix cell, from accum_keys.
; Atari: SKSTAT key-down from the DLI and the VBI. IRQST bit 6 stays
; inactive while IRQEN is 0, so it cannot be polled. A changed KBCODE
; counts as a new press when the release fell between samples.
; apply_cheats on main does HUD, sound, and restart_level.
; Shared "id" prefix, then dqd / kfa / mapNN.
!zone cheats

CHEAT_IDLE	= 0
CHEAT_GOT_I	= 1
CHEAT_AFTER_ID	= 2
CHEAT_REQ_GOD	= 1
CHEAT_REQ_KFA	= 2
CHEAT_REQ_MAP	= 3

; god, kfa, map, three keys each. Index is the table offset; base/end
; bound it. Digits are a separate 1..9 pair.

; POKEY KBCODE & $3F. Same positions a8_keys uses for 1..4.
cheat_kc	!byte $3a, $2f, $3a			; D Q D
		!byte $05, $38, $3f			; K F A
		!byte $25, $3f, $0a			; M A P
cheat_kc_dig	!byte $1f, $1e, $1a, $18, $1d, $1b, $33, $35, $30

cheat_base	!byte 0, 3, 6
cheat_end	!byte 3, 6, 9


; ---------------------------------------------------------------------------
cheat_init
	lda #0
	sta god_mode
	sta cheat_req
	sta cheat_ep_latch
	sta cheat_map_latch
	sta cheat_kdown
	jmp cheat_reset_all


CHEAT_KC_I	= $0d
CHEAT_KC_D	= $3a

; DLI and VBI. SKSTAT bit 2 clear = a key is down. cheat_kdown is 0
; after a sample saw the key up, else the last accepted code + 1.
; A new code while the bit stays down is the release we did not sample.
check_cheats
	lda $d20f
	and #$04
	beq .down
	lda #0
	sta cheat_kdown
	rts
.down
	lda $d209
	and #$3f
	clc
	adc #1
	cmp cheat_kdown
	beq .rts
	sta cheat_kdown
	lda player_hp
	beq .rts
	lda cheat_kdown
	sec
	sbc #1
	sta cheat_a
	lda cheat_phase
	beq .idle
	cmp #CHEAT_GOT_I
	beq .got_i
	jmp .after_id

.idle
	lda cheat_a
	cmp #CHEAT_KC_I
	bne .rts
	lda #CHEAT_GOT_I
	sta cheat_phase
.rts
	rts

.got_i
	lda cheat_a
	cmp #CHEAT_KC_D
	bne .rts
	jsr cheat_clear_suf
	lda #CHEAT_AFTER_ID
	sta cheat_phase
	rts

.after_id
	lda cheat_a
	cmp #CHEAT_KC_I			; another I restarts the prefix
	bne .suf
	jsr cheat_clear_suf
	lda #CHEAT_GOT_I
	sta cheat_phase
	rts

.suf
	ldx #0
.suf_lp
	jsr cheat_step
	inx
	cpx #3
	bcc .suf_lp
	rts

; X = suffix 0..2. cheat_a = keycode. Map takes two digits once its
; index reaches cheat_end. A miss does not reset the suffix.
cheat_step
	cpx #2
	bne .st_let
	lda cheat_map
	cmp cheat_end + 2
	bcs .st_dig
.st_let
	ldy cheat_god,x
	lda cheat_kc,y
	cmp cheat_a
	bne .st_rts
	inc cheat_god,x
	lda cheat_god,x
	cmp cheat_end,x
	bne .st_rts
	cpx #2
	beq .st_rts			; letters done; digits are later presses
	inx				; req = slot + 1
	pla
	pla				; drop cheat_step, rts back to the VBI
	jmp cheat_latch
.st_dig
	ldy #0
.std_lp
	lda cheat_kc_dig,y
	cmp cheat_a
	beq .std_hit
	iny
	cpy #9
	bcc .std_lp
	rts
.std_hit
	iny				; 1..9
	lda cheat_map
	cmp cheat_end + 2
	bne .st_mapn
	sty cheat_ep_dig
	inc cheat_map
	rts
.st_mapn
	sty cheat_map_dig
	lda cheat_ep_dig
	sta cheat_ep_latch
	lda cheat_map_dig
	sta cheat_map_latch
	pla
	pla
	ldx #CHEAT_REQ_MAP
	jmp cheat_latch
.st_rts
	rts


cheat_clear_suf
	ldx #2
.cs_b
	lda cheat_base,x
	sta cheat_god,x
	dex
	bpl .cs_b
	rts

cheat_reset_all
	jsr cheat_clear_suf
	lda #0
	sta cheat_phase
	rts

; X = CHEAT_REQ_*. Ignore it when one is already waiting.
cheat_latch
	lda cheat_req
	beq .lt_set
	jmp cheat_reset_all
.lt_set
	stx cheat_req
	jmp cheat_reset_all

