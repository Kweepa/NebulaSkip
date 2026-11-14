; DNA terminal, resident half. Standing in a `terminal` trigger volume, fire
; (which never shoots there) opens a modal 32 x 16 ANTIC mode 2 text screen in
; place of the 3D viewport. The screens, their tables and text are in segment E
; (e_term.asm, e_ship.asm, e_rig.asm, terminal_data.asm, terminal_text.asm):
; main RAM under the bank window, entered through terminal_enter. Here: state
; init, the per-frame poll, and the bits counter the rest of the game uses.
!zone terminal

; ------------------------------------------------------------------
; term_init — new game (start). Bits start at 42.
; ------------------------------------------------------------------
term_init
	lda #0
	sta term_in
	sta term_arm
	sta term_on
	sta term_scr
	sta term_sel
	sta term_old
	sta bounty_acc
	sta bounty_acc_h
	sta shop_owned
	sta shop_owned_h
	sta ship_seen
	sta ship_seen_h
	sta rig_arm
	sta rig_shown
	sta rig_stage
	sta bits_h
	lda #42
	sta bits_l
	rts

; ------------------------------------------------------------------
; term_poll — every frame after read_input, before update_weapon.
; Inside a terminal volume fire is taken: key_fire is zeroed so nothing
; shoots, jumps or buzzes. A press opens the terminal only if fire was seen
; released while inside (walking in with fire held does not open it).
; ------------------------------------------------------------------
term_poll
	lda term_in
	bne .tp_in
	sta term_arm
	rts
.tp_in
	lda key_fire
	bne .tp_fire
	lda #1
	sta term_arm
	rts
.tp_fire
	lda #0
	sta key_fire
	lda term_arm
	beq .tp_rts
	lda #0
	sta term_arm
	jmp terminal_enter
.tp_rts
	rts

; ------------------------------------------------------------------
; terminal_enter — the modal terminal loop (terminal_run, segment E). term_in
; picks the screen: DNA terminal, ship chart, or TRIG_RIG (rig_poll). It ends in
; jmp a8_nmi_on, which returns here. Travel from the ship chart leaves through
; s_go (ship.asm), which restores the play window itself and comes back here
; from enter_card.
; ------------------------------------------------------------------
terminal_enter
	jsr e_enter
	jsr E_TERMINAL
	jmp e_leave


; ------------------------------------------------------------------
; hud_bits — bits as 4 digits under the "bits" label on the value row. Ammo
; variables and their plumbing are untouched, just not drawn.
; ------------------------------------------------------------------
hud_bits
	lda bits_l
	ldx bits_h
	jsr bin16_dec5
	lda #<HUD_SCR + HUD_OFF_VALUE + HUD_BITS_COL
	sta dst_ptr
	lda #>HUD_SCR + HUD_OFF_VALUE + HUD_BITS_COL
	sta dst_ptr + 1
	ldy #3
.hb_l
	lda dec5 + 1,y
	sta (dst_ptr),y
	dey
	bpl .hb_l
	rts

; A = lo, X = hi added to bits, clamped to BITS_MAX. Called by gb_do_bits
; (wallet / safe); bounty rewards will too.
bits_add
	clc
	adc bits_l
	sta bits_l
	txa
	adc bits_h
	sta bits_h
	lda bits_l
	cmp #<(BITS_MAX + 1)
	lda bits_h
	sbc #>(BITS_MAX + 1)
	bcc .ba_ok
	lda #<BITS_MAX
	sta bits_l
	lda #>BITS_MAX
	sta bits_h
.ba_ok
	rts

; bin16_dec5 lives in ship.asm (segment A).
