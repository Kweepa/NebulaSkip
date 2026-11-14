; Cheat codes. C64: next CIA1 matrix cell, from accum_keys.
; Atari: SKSTAT key-down from the DLI and the VBI. IRQST bit 6 stays
; inactive while IRQEN is 0, so it cannot be polled. A changed KBCODE
; counts as a new press when the release fell between samples.
; apply_cheats on main does HUD, sound, and restart_level.
; No prefix. Words: god, bit, map + one letter a..z (level 1..).
!zone cheats

CHEAT_REQ_GOD	= 1
CHEAT_REQ_BIT	= 2
CHEAT_REQ_MAP	= 3

; god, bit, map, three keys each. Index is the table offset; base/end
; bound it. cheat_map reaching end = waiting for the map letter.

; POKEY KBCODE & $3F. Same positions a8_keys uses for W A S D I J L.
cheat_kc	!byte $3d, $08, $3a			; G O D
		!byte $15, $0d, $2d			; B I T
		!byte $25, $3f, $0a			; M A P
cheat_kc_let	!byte $3f, $15, $12, $3a, $2a, $38, $3d, $39, $0d	; A..I
		!byte $01, $05, $00, $25, $23, $08, $0a, $2f		; J..Q
		!byte $28, $3e, $2d, $0b, $10, $2e, $16, $2b, $17	; R..Z

cheat_base	!byte 0, 3, 6
cheat_end	!byte 3, 6, 9


; ---------------------------------------------------------------------------
cheat_init
	lda #0
	sta god_mode
	sta cheat_req
	sta cheat_map_latch
	sta cheat_kdown
	jmp cheat_clear_suf


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
	lda cheat_map
	cmp cheat_end + 2
	bne .words
	jsr cheat_clear_suf		; "map" typed: this key is the letter, hit or miss
	ldy #25
.let_lp
	lda cheat_kc_let,y
	cmp cheat_a
	beq .let_hit
	dey
	bpl .let_lp
	bmi .words			; not a letter: treat it as a fresh key
.let_hit
	iny				; a = 1
	sty cheat_map_latch
	ldx #CHEAT_REQ_MAP
	jmp cheat_latch

.words
	ldx #0
.w_lp
	jsr cheat_step
	inx
	cpx #3
	bcc .w_lp
.rts
	rts

; X = word 0..2. cheat_a = keycode. A miss restarts the word; the key
; itself counts as its first letter (no word repeats a letter).
cheat_step
	ldy cheat_god,x
	lda cheat_kc,y
	cmp cheat_a
	bne .st_miss
	inc cheat_god,x
	lda cheat_god,x
	cmp cheat_end,x
	bne .st_rts
	cpx #2
	beq .st_rts			; map: the letter is the next press
	inx				; req = slot + 1
	pla
	pla				; drop cheat_step, rts back to the VBI
	jmp cheat_latch
.st_miss
	ldy cheat_base,x
	lda cheat_kc,y
	cmp cheat_a
	bne .st_clr
	iny
.st_clr
	tya
	sta cheat_god,x
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

; X = CHEAT_REQ_*. Ignore it when one is already waiting.
cheat_latch
	lda cheat_req
	bne cheat_clear_suf
	stx cheat_req
	jmp cheat_clear_suf

