; DNA terminal screens (segment E, sege.asm). Welcome screen with Shop / Bounties /
; Quit; the lists come from shop.csv / bounties.csv (tools/genterminal.py ->
; terminal_data.asm, also in E). The ship chart (e_ship.asm) and the rig scan
; (e_rig.asm) are further screens of the same loop.
;
; Entered from terminal_enter (terminal.asm) with the window on main RAM
; (portb_cur = PORTB_MAIN): the text screen is BMP_B, so rows are composed in
; term_row and copied straight in. Nothing here can read bank 0 (map columns):
; rig_poll hands the rig screen what it needs in BSS.
; Colours: mode 2 ink hue = paper hue, so blue paper means light-blue ink (the
; menu panel look). The seam DLI sets PF2 = dli_ink and PF1 = the dli_blood
; operand; a8_vbi overrides dli_ink with term_pf2 while term_on.
!zone terminal

; ------------------------------------------------------------------
; terminal_run — modal. Ends with jmp a8_nmi_on (returns to terminal_enter).
; ------------------------------------------------------------------
terminal_run
	lda #SOUND_DOROPN
	jsr play_sound
	lda #1
	sta den_arm				; DMA off while the list pointer changes
	jsr t_frame
	lda #0
	sta msg_on				; no flashing message row while in the terminal;
	sta status_ms_l				; update_triggers redraws it after we leave
	sta status_ms_h
	jsr hud_msg_blank
	ldx #0					; term_in = the trigger purpose: DNA terminal, ship, or
	lda term_in				; TRIG_RIG (rig_poll: bounty scan)
	cmp #TRIG_SHIP
	bne .tr_k1
	inx
	bne .tr_k
.tr_k1
	cmp #TRIG_RIG
	bne .tr_k
	ldx #2
.tr_k
	stx term_kind
	lda t_paper,x				; blue (DNA) / red (ship) / green (rig), NTSC byte, PAL-corrected
	jsr a8_to_pal
	sta term_pf2
	lda dli_blood+1
	sta term_blood_sv
	lda #TERM_LUM_N				; ink luminance (PF1), same as the menu panels
	sta dli_blood+1
	jsr t_build_dl
	lda #0
	sta term_scr
	sta term_sel
	lda #3
	sta term_n
	lda term_kind
	beq .tr_s0
	cmp #2
	beq .tr_ro
	jsr s_open				; ship: chart screen, cursor on this map
	jmp .tr_s0
.tr_ro
	jsr r_open				; rig: pick the crimes, arm the timeline
.tr_s0
	jsr t_read				; swallow the held fire: no edge until re-pressed
	jsr t_draw
	lda #1
	sta term_on
	lda #<term_dl
	sta dl_top+2
	lda #>term_dl
	sta dl_top+3
	lda #2
	sta den_arm
t_loop						; e_ship.asm / e_rig.asm return here too
.tr_loop
	jsr t_frame
	lda term_kind
	cmp #2
	bne .tr_in
	jsr r_tick				; rig: timed reveal; only fire is read
	jsr t_read
	and #4
	beq .tr_loop
	jmp .tr_fire
.tr_in
	jsr t_read
	beq .tr_loop
	lsr					; bit0 up
	bcs .tr_up
	lsr					; bit1 down
	bcs .tr_down
	lsr					; bit2 fire
	bcs .tr_fire
	bcc .tr_loop
.tr_up
	ldx term_sel
	bne .tr_u1
	ldx term_n
.tr_u1
	dex
	stx term_sel
	jmp .tr_curs
.tr_down
	ldx term_sel
	inx
	cpx term_n
	bcc .tr_d1
	ldx #0
.tr_d1
	stx term_sel
.tr_curs
	lda #SOUND_SWTCHN
	jsr play_sound
	jsr t_redraw			; same layout: no clear, so no blank flash
	jmp .tr_loop
.tr_moved					; A = sound: door open into a screen, door close back out
	jsr play_sound
	jsr t_draw
	jmp .tr_loop
.tr_refuse
	lda #SOUND_OOF
	jsr play_sound
	jmp .tr_loop
.tr_fire
	lda term_scr
	bne .tr_fs
	jmp .tr_fmain				; (branch range)
.tr_fs
	cmp #3
	bne .tr_f4
	jmp s_fire				; ship chart (e_ship.asm), returns via t_loop / t_leave
.tr_f4
	cmp #4
	bne .tr_f12
	jmp r_fire				; rig scan (e_rig.asm), returns via t_loop / t_leave
.tr_f12
	ldx term_sel
	inx
	cpx term_n
	beq .tr_return
	cmp #1
	beq .tr_buy
	; bounty accepted: its map stays on the ship chart for good (no current bounty)
	dex					; X = bounty index
	jsr t_bty_acc
	lda bty_map,x
	tax
	dex					; node index = map - 1
	jsr sh_mark
	lda #SOUND_ITEMUP
	jsr play_sound
	lda #0
	sta term_scr
	lda #1
	sta term_sel
	lda #3
	sta term_n
	jsr t_draw
	jmp .tr_loop
.tr_buy
	dex					; X = item index
	jsr t_owned
	bne .tr_refuse
	sec
	lda bits_l
	sbc shop_price_lo,x
	sta term_tmp2
	lda bits_h
	sbc shop_price_hi,x
	bcc .tr_refuse				; cannot afford
	sta bits_h
	lda term_tmp2
	sta bits_l
	jsr t_setowned
	jsr hud_bits
	lda #SOUND_ITEMUP
	jsr play_sound
	jsr t_redraw
	jmp .tr_loop
.tr_return
	ldx term_scr				; shop 1 / bounties 2 -> main row 0 / 1
	dex
	stx term_sel
	lda #0
	sta term_scr
	lda #3
	sta term_n
	lda #SOUND_DORCLS
	jmp .tr_moved
.tr_fmain
	lda term_sel
	beq .tr_shop
	cmp #1
	beq .tr_bty
	jmp t_leave				; quit
.tr_shop
	lda #1
	ldx #SHOP_N + 1
	bne .tr_list
.tr_bty
	lda #2
	ldx #BTY_N + 1
.tr_list
	sta term_scr
	stx term_n
	lda #0
	sta term_sel
	lda #SOUND_DOROPN
	jmp .tr_moved

; ------------------------------------------------------------------
; t_leave — back to the 3D view. Blank until the main loop publishes a frame
; (den_arm 1 -> 2), as enter_card does, so no stale text flashes.
; ------------------------------------------------------------------
t_leave
	lda #SOUND_DORCLS
	jsr play_sound
	lda #1
	sta den_arm
	jsr t_frame
	jsr t_fixmargin			; the text overwrote BMP_B's zeroed gutters
	lda #<DL
	sta dl_top+2
	lda #>DL
	sta dl_top+3
	lda #0
	sta term_on
	lda term_blood_sv
	sta dli_blood+1
.tl_rel
	jsr t_frame				; fire must be released or it shoots on return
	jsr t_raw
	and #4
	bne .tl_rel
	lda #0
	sta $d40e				; NMI off: sei does not block it
	tax
.tl_z
	sta in_fwd,x				; in_fwd .. in_turn_r
	inx
	cpx #12
	bcc .tl_z
	sta mouse_turn
	sta mouse_turn_h
	sta in_fire
	sta in_ability
	sta term_arm
	lda vbi_count_l
	sta vbi_last_l
	lda vbi_count_h
	sta vbi_last_h
	jmp a8_nmi_on

; BMP_B gutters (bytes 0-3, 28-31 of each row) are zeroed once per buffer and
; the 3D draw never touches them; the text screen overwrote them.
t_fixmargin
	lda bmp_hi
	pha
	lda #>BMP_B
	sta bmp_hi
	jsr a8_init_margin		; the window is already main RAM
	pla
	sta bmp_hi
	rts

; ------------------------------------------------------------------
; Input. t_raw: A = b0 up, b1 down, b2 fire (level). t_read: new presses only.
; ------------------------------------------------------------------
t_raw
	lda stick_bits
	and #3
	sta term_tmp
	lda $d010				; STRIG0, 0 = pressed
	beq .tw_f
	lda mouse_en
	beq .tw_n
	lda $d011				; ST mouse left button
	bne .tw_n
.tw_f
	lda term_tmp
	ora #4
	rts
.tw_n
	lda term_tmp
	rts

t_read
	jsr t_raw
	sta term_tmp2
	eor term_old
	and term_tmp2
	pha
	lda term_tmp2
	sta term_old
	pla
	rts

t_frame
	lda frame_flag
.tf_w
	cmp frame_flag
	beq .tf_w
	rts

; ------------------------------------------------------------------
; Display list: live DL[0..12] (HUD, mouse variants, DLIs, seam blank), then
; 16 mode 2 rows from TERM_SCR (32 columns under the seam's narrow playfield).
; ------------------------------------------------------------------
t_build_dl
	ldx #12
.bd_h
	lda DL,x
	sta term_dl,x
	dex
	bpl .bd_h
	lda #$42
	sta term_dl + 13
	lda #<TERM_SCR
	sta term_dl + 14
	lda #>TERM_SCR
	sta term_dl + 15
	lda #$02
	ldx #TERM_ROWS - 2
.bd_r
	sta term_dl + 16,x
	dex
	bpl .bd_r
	lda #$41
	sta term_dl + 16 + TERM_ROWS - 1
	lda #<dl_top
	sta term_dl + 16 + TERM_ROWS
	lda #>dl_top
	sta term_dl + 16 + TERM_ROWS + 1
	rts

; ------------------------------------------------------------------
; Row composition. term_row is one 32-byte row; t_blit copies it to screen
; row A (0..15). Chars are raw ASCII (UI charset). Row 0 stays
; blank: the seam DLI writes its colours a little into the first scanline.
; ------------------------------------------------------------------
t_rbegin
	lda #' '
	ldx #TERM_COLS - 1
.rb_l
	sta term_row,x
	dex
	bpl .rb_l
	rts

t_rule
	lda #'-'
	ldx #TERM_COLS - 1
.ru_l
	sta term_row,x
	dex
	bpl .ru_l
	rts

; src_ptr string -> term_row at column X; stops at NUL or the right edge.
; Returns X = column after the last char (length if X started at 0).
t_puts
	ldy #0
.tp_l
	lda (src_ptr),y
	beq .tp_d
	cpx #TERM_COLS
	bcs .tp_d
	sta term_row,x
	inx
	iny
	bne .tp_l
.tp_d
	rts

; A/Y = string lo/hi, X = column
t_str
	sta src_ptr
	sty src_ptr + 1
	jmp t_puts

; A = screen row. Clobbers A, Y, dst_ptr.
t_blit
	pha
	lsr
	lsr
	lsr
	clc
	adc #>TERM_SCR
	sta dst_ptr + 1
	pla
	and #7
	asl
	asl
	asl
	asl
	asl
	sta dst_ptr				; TERM_SCR is page aligned
	ldy #TERM_COLS - 1
.bl_l
	lda term_row,y
	sta (dst_ptr),y
	dey
	bpl .bl_l
	rts

; Blit row A, with the cursor glyph (char 126) in column 0 if X is the
; highlighted item.
t_selblit
	pha
	cpx term_sel
	bne .sb_n
	lda #126
	sta term_row
.sb_n
	pla
	jmp t_blit

; A = lo, X = hi, Y = column: 5 right-aligned digits (leading zeros blank).
t_num
	sty term_tmp
	jsr bin16_dec5
	ldx #0
.tn_s
	lda dec5,x
	cmp #'0'
	bne .tn_d
	lda #' '
	sta dec5,x
	inx
	cpx #4
	bcc .tn_s
.tn_d
	ldx #0
	ldy term_tmp
.tn_c
	lda dec5,x
	sta term_row,y
	iny
	inx
	cpx #5
	bcc .tn_c
	rts

t_clear
	jsr t_rbegin
	lda #0
	sta term_tmp2
.tc_l
	lda term_tmp2
	jsr t_blit
	inc term_tmp2
	lda term_tmp2
	cmp #TERM_ROWS
	bcc .tc_l
	rts

; ------------------------------------------------------------------
; Screens
; ------------------------------------------------------------------
t_draw
	jsr t_clear
t_redraw
	lda term_scr
	cmp #4
	bne .td_h
	jmp r_draw				; rig scan: no cursor, so no highlight DLIs
.td_h
	jsr t_hilite
	lda term_scr
	bne .td_list
	jmp t_draw_main
.td_list
	cmp #3
	bne .td_l12
	jmp s_draw				; ship chart (e_ship.asm)
.td_l12
	jmp t_draw_list

; Cursor row highlight: a DLI on the row above and on the cursor row itself
; (a8irq .nm_term raises, then restores, PF1 luminance). Main menu items are at
; rows 8.., list items at 3.., ship nodes at 2.. (the cursor row is always >= 2, so
; the row above is a real row, never the row-0 LMS).
t_hilite
	lda #$42
	sta term_dl + 13			; row 0: LMS, no DLI
	lda #$02
	ldx #TERM_ROWS - 2
.hl_c
	sta term_dl + 16,x			; rows 1..15
	dex
	bpl .hl_c
	lda term_sel
	ldx term_scr
	bne .hl_l
	clc
	adc #8
	bne .hl_s				; always: >= 8
.hl_l
	cpx #3
	bne .hl_l12
	jsr s_row				; ship chart: A = row of the node
	jmp .hl_s
.hl_l12
	clc
	adc #3
.hl_s
	tax					; X = cursor row r (>= 3): DL byte 15 + r
	lda term_dl + 15,x
	ora #$80
	sta term_dl + 15,x
	lda term_dl + 14,x			; row r - 1
	ora #$80
	sta term_dl + 14,x
	rts

t_draw_main
	jsr t_rbegin
	lda #<t_s_title
	ldy #>t_s_title
	ldx #10
	jsr t_str
	lda #1
	jsr t_blit
	jsr t_rule
	lda #2
	jsr t_blit
	jsr t_rbegin
	lda #0					; greeting lines from terminal.txt, rows 4..
	sta term_tmp2
.dm_g
	lda term_tmp2
	cmp #GREET_N
	bcs .dm_gd
	jsr t_rbegin
	ldx term_tmp2
	lda greet_lo,x
	ldy greet_hi,x
	ldx #1
	jsr t_str
	lda term_tmp2
	clc
	adc #4
	jsr t_blit
	inc term_tmp2
	bne .dm_g				; always
.dm_gd
	lda #0
	sta term_tmp2
.dm_l
	jsr t_rbegin
	ldx term_tmp2
	lda t_mi_lo,x
	ldy t_mi_hi,x
	ldx #2
	jsr t_str
	lda term_tmp2
	clc
	adc #8
	ldx term_tmp2
	jsr t_selblit
	inc term_tmp2
	lda term_tmp2
	cmp #3
	bcc .dm_l
	lda bounty_acc
	ora bounty_acc_h
	beq .dm_x
	jsr t_rbegin
	lda #<t_s_access
	ldy #>t_s_access
	ldx #1
	jsr t_str
	lda #12
	jsr t_blit
.dm_x
	rts

; Shop (term_scr 1) / bounties (2): header, rule, one row per item, return,
; rule, description of the highlighted item on rows 13..15.
t_draw_list
	jsr t_rbegin
	ldx term_scr
	lda t_hl_lo - 1,x
	ldy t_hl_hi - 1,x
	ldx #2
	jsr t_str
	ldx term_scr
	lda t_hr_lo - 1,x
	ldy t_hr_hi - 1,x
	ldx #25
	jsr t_str
	lda #1
	jsr t_blit
	jsr t_rule
	lda #2
	jsr t_blit
	lda #0
	sta term_tmp2
.dl_i
	jsr t_rbegin
	ldx term_tmp2
	inx
	cpx term_n
	beq .dl_ret
	ldx term_tmp2
	jsr t_marker
	jsr t_nameptr
	ldx #2
	jsr t_puts
	ldx term_tmp2
	lda term_scr
	cmp #2
	beq .dl_bty
	lda shop_price_lo,x
	pha
	lda shop_price_hi,x
	tax
	pla
	ldy #26
	jsr t_num
	jmp .dl_row
.dl_bty
	lda bty_diff,x
	tay
	ldx #0
.dl_dd
	lda bty_diff_str,y
	sta term_row + 25,x
	iny
	inx
	cpx #DIFF_W
	bcc .dl_dd
	jmp .dl_row
.dl_ret
	lda #<t_s_return
	ldy #>t_s_return
	ldx #2
	jsr t_str
.dl_row
	ldx term_tmp2
	lda term_tmp2
	clc
	adc #3
	jsr t_selblit
	inc term_tmp2
	lda term_tmp2
	cmp term_n
	bcc .dl_i
	jsr t_rule
	lda #T_DESC_RULE
	jsr t_blit
	jsr t_rbegin				; description rows may shrink: blank them first
	lda #T_DESC_RULE + 1
	sta term_tmp2
.dl_b
	lda term_tmp2
	jsr t_blit
	inc term_tmp2
	lda term_tmp2
	cmp #TERM_ROWS
	bcc .dl_b
	ldx term_sel
	inx
	cpx term_n
	beq .dl_done				; the return row has no description
	dex
	jsr t_descptr
	lda #T_DESC_RULE + 1
	sta term_tmp2
.dl_d
	ldy #0
	lda (src_ptr),y
	beq .dl_done				; empty line ends the description
	jsr t_rbegin
	ldx #1					; indent; lines are wrapped to 30 by genterminal
	jsr t_puts
	clc					; X = 1 + length: past the NUL
	txa
	adc src_ptr
	sta src_ptr
	bcc .dl_d1
	inc src_ptr + 1
.dl_d1
	lda term_tmp2
	jsr t_blit
	inc term_tmp2
	lda term_tmp2
	cmp #TERM_ROWS
	bcc .dl_d
.dl_done
	rts

; X = item index -> src_ptr = name / description of the current list. X kept.
t_nameptr
	lda term_scr
	cmp #2
	beq .np_b
	lda shop_name_lo,x
	sta src_ptr
	lda shop_name_hi,x
	sta src_ptr + 1
	rts
.np_b
	lda bty_name_lo,x
	sta src_ptr
	lda bty_name_hi,x
	sta src_ptr + 1
	rts

t_descptr
	lda term_scr
	cmp #2
	beq .dp_b
	lda shop_desc_lo,x
	sta src_ptr
	lda shop_desc_hi,x
	sta src_ptr + 1
	rts
.dp_b
	lda bty_desc_lo,x
	sta src_ptr
	lda bty_desc_hi,x
	sta src_ptr + 1
	rts

; Row marker in the last column: shop = bought, bounties = the accepted one.
t_marker
	lda term_scr
	cmp #2
	beq .mk_b
	jsr t_owned
	bne .mk_set
	rts
.mk_b
	txa
	and #7
	tay
	lda t_bit,y
	cpx #8
	bcs .mk_h
	and bounty_acc
	jmp .mk_t
.mk_h
	and bounty_acc_h
.mk_t
	beq .mk_n
.mk_set
	lda #'x'
	sta term_row + TERM_COLS - 1
.mk_n
	rts

; X = shop item -> A nonzero if bought. X kept.
t_owned
	txa
	and #7
	tay
	lda t_bit,y
	cpx #8
	bcs .ow_h
	and shop_owned
	rts
.ow_h
	and shop_owned_h
	rts

; X = bounty index -> set its bit in bounty_acc. X kept.
t_bty_acc
	txa
	and #7
	tay
	lda t_bit,y
	cpx #8
	bcs .ba_h
	ora bounty_acc
	sta bounty_acc
	rts
.ba_h
	ora bounty_acc_h
	sta bounty_acc_h
	rts

t_setowned
	txa
	and #7
	tay
	lda t_bit,y
	cpx #8
	bcs .so_h
	ora shop_owned
	sta shop_owned
	rts
.so_h
	ora shop_owned_h
	sta shop_owned_h
	rts
