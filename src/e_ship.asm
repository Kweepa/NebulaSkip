; Player ship: the nebula chart (segment E, sege.asm). Same modal as the DNA
; terminal (e_term.asm term_scr 3, the terminal loop does input / DL / cursor
; DLI), but the screen is a chart of the maps (nodes from ship_map.csv via
; terminal_data.asm) and fire on a node travels there. Pink on red: term_kind 1
; picks TERM_PAPER_SHIP. sh_mark, s_go and the travel itself are resident (ship.asm).
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
	; Travel: tear the text screen down as t_leave does (it lives in this
	; window), then s_go (resident) loads the map. X = destination.
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
	ldx sh_tmp
	jmp s_go
.sf_no
	lda #SOUND_OOF
	jsr play_sound
	jmp t_loop
.sf_leave
	jmp t_leave
