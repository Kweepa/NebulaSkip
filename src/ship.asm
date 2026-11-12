; Player ship: the nebula chart. Same modal as the DNA terminal (terminal.asm
; term_scr 3, the terminal loop does input / DL / cursor DLI), but the screen is
; a chart of the maps (nodes from ship_map.csv via terminal_data.asm) and fire on
; a node travels there. Pink on red: term_kind 1 picks TERM_PAPER_SHIP.
;
; Segment A (main RAM, always visible). Everything here runs from the terminal
; loop at PORTB_PLAY, so the bank-0 static tables (sm_*, t_s_*, t_bit) can be read
; directly; t_blit switches to PORTB_MAIN for the row copy itself.
;
; Reachable: the current map, the accepted bounty's map, and any map visited
; (ship_seen, quicksaved). Travel reloads the target map at its spawn like
; next_level does: HP / ammo / weapons / bits are kept, keys are per-map.
!zone ship

; ------------------------------------------------------------------
; s_open — terminal_run entry for the ship. Cursor starts on this map.
; ------------------------------------------------------------------
s_open
	lda #3
	sta term_scr
	lda #SHIP_N
	sta term_n
	ldx level_num
	dex
	stx term_sel
	jmp sh_mark

; X = node index (map - 1, 0..15) -> bit in ship_seen. Clobbers A, Y.
sh_mark
	txa
	and #7
	tay
	lda t_bit,y
	cpx #8
	bcs .sm_h
	ora ship_seen
	sta ship_seen
	rts
.sm_h
	ora ship_seen_h
	sta ship_seen_h
	rts

; X = node index -> Z clear if visited. X kept.
sh_seen
	txa
	and #7
	tay
	lda t_bit,y
	cpx #8
	bcs .ss_h
	and ship_seen
	rts
.ss_h
	and ship_seen_h
	rts

; X = node index -> Z clear if the ship can go there (or is there). X kept.
sh_reach
	inx
	cpx level_num
	beq .sr_y
	cpx bounty_map				; 0 = none; X >= 1 here
	beq .sr_y
	dex
	jmp sh_seen
.sr_y
	dex
	lda #1
	rts

; A = screen row of the highlighted node.
s_row
	ldx term_sel
	lda sm_row,x
	rts

; ------------------------------------------------------------------
; s_draw — whole chart. t_hilite (cursor DLI rows) has already run.
; Row 0 title, nodes on their rows (2..14: the DLI row above the cursor must be
; row 1 or later), row 15 status for the highlighted node. The highlight is the
; DLI text colour only. Node icons (UI font): '<' available destination (this map
; included), '=' unavailable (name shown as ???).
; ------------------------------------------------------------------
s_draw
	jsr t_rbegin
	lda #<t_s_ship
	ldy #>t_s_ship
	ldx #10
	jsr t_str
	lda #0
	jsr t_blit
	lda #0
	sta sh_tmp
.sd_n
	jsr t_rbegin
	ldx sh_tmp
	jsr sh_reach
	beq .sd_lock
	lda #'<'
	ldy sm_col,x
	sta term_row,y
	lda sm_name_lo,x
	sta src_ptr
	lda sm_name_hi,x
	sta src_ptr + 1
	lda sm_col,x
	clc
	adc #2
	tax
	jsr t_puts
	jmp .sd_b
.sd_lock
	lda #'='
	ldy sm_col,x
	sta term_row,y
	lda sm_col,x
	clc
	adc #2
	tax
	lda #<t_s_unk
	ldy #>t_s_unk
	jsr t_str
.sd_b
	ldx sh_tmp
	lda sm_row,x
	jsr t_blit
	inc sh_tmp
	lda sh_tmp
	cmp #SHIP_N
	bcc .sd_n
	jsr t_rbegin
	ldx term_sel
	jsr sh_reach
	bne .sd_ok
	lda #<t_s_locked
	ldy #>t_s_locked
	bne .sd_put				; static data is above $4000: Y != 0
.sd_ok
	inx
	cpx level_num
	bne .sd_go
	lda #<t_s_here
	ldy #>t_s_here
	bne .sd_put
.sd_go
	lda #<t_s_go
	ldy #>t_s_go
.sd_put
	ldx #1
	jsr t_str
	lda #15
	jmp t_blit

; ------------------------------------------------------------------
; s_fire — fire on the highlighted node. This map disembarks, a locked route is
; refused, a reachable map travels.
; ------------------------------------------------------------------
s_fire
	ldx term_sel
	jsr sh_reach
	beq .sf_no
	inx					; map number
	cpx level_num
	beq .sf_leave
	jmp s_go
.sf_no
	lda #SOUND_OOF
	jsr play_sound
	jmp t_loop
.sf_leave
	jmp t_leave

; ------------------------------------------------------------------
; s_go — X = destination map (1..SHIP_N). Tear the text screen down as t_leave
; does, then load the map the way next_level does. Ends in enter_card, which
; returns to the main loop through a8_nmi_on. init_irq (play_up1) rewrites
; dli_blood+1, so term_blood_sv is not restored here.
; ------------------------------------------------------------------
s_go
	stx sh_tmp
	lda #1
	sta den_arm
	jsr t_frame
	jsr t_fixmargin
	lda #<DL
	sta dl_top + 2
	lda #>DL
	sta dl_top + 3
	lda #0
	sta term_on
	sta term_arm
	sta term_in
	sta have_keys				; keys are per-map
	ldx sh_tmp
	stx level_num
	dex
	jsr sh_mark
	jsr restart_level
	bcc .go_ok
	jmp load_fail_hang
.go_ok
	lda #1
	sta den_arm
	jmp enter_card

; ------------------------------------------------------------------
; A = lo, X = hi -> dec5[0..4] ASCII, zero padded. Clobbers A, X. Moved here from
; terminal.asm to free room in segment B. Powers of ten live in code: hud_bits can
; run outside a PORTB_PLAY window.
; ------------------------------------------------------------------
bin16_dec5
	sta d5_lo
	stx d5_hi
	ldx #0
.b5_p
	lda #'0' - 1
	sta dec5,x
.b5_s
	inc dec5,x
	sec
	lda d5_lo
	sbc b5_pw_lo,x
	sta d5_t
	lda d5_hi
	sbc b5_pw_hi,x
	bcc .b5_d
	sta d5_hi
	lda d5_t
	sta d5_lo
	bcs .b5_s				; C set from the sbc
.b5_d
	inx
	cpx #4
	bcc .b5_p
	lda d5_lo
	ora #'0'
	sta dec5 + 4
	rts
b5_pw_lo
	!byte <10000, <1000, <100, <10
b5_pw_hi
	!byte >10000, >1000, >100, >10
