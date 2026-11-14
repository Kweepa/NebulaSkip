; DNA rig scan screen (segment E, sege.asm). Opened by rig_poll (rig.asm) through
; terminal_enter with term_kind 2 / term_scr 4: name, 1..3 random crimes from
; crimes.txt (after "crimes:"), bounty, status, an upload bar, then the bounty
; (4n-1 bits) is paid. Fire closes it once paid.
; r_open / r_draw / r_tick / r_fire run from the terminal loop (e_term.asm). The
; corpse's bounty name and value come from rig_name / rig_bty (BSS, filled by
; rig_poll): the map itself is in bank 0 and not visible from here.
!zone rig

; Timeline (ms to wait after each stage)
RIG_T_OPEN	= 600
RIG_T_NAME	= 500
RIG_T_LABEL	= 400
RIG_T_CRIME	= 450
RIG_T_BOUNTY	= 700			; after the last crime, before the bounty line
RIG_T_STAT	= 500			; bounty line -> "status: deceased"
RIG_T_UPL	= 500			; status line -> "uploading"
RIG_T_BAR0	= 400			; "uploading" -> first #
RIG_T_BAR	= 20			; minimum pause between bar jumps (random 0..120 ms added)
RIG_T_PAY	= 400			; full bar -> paid

!macro rig_wait .ms {
	lda #<.ms
	sta rig_wait_l
	lda #>.ms
	sta rig_wait_h
}

; ------------------------------------------------------------------
; r_open — terminal_run entry for the scan: pick 1..3 distinct crimes, arm the timeline.
; ------------------------------------------------------------------
r_open
	lda #4
	sta term_scr
	lda #1
	sta term_n
	lda #0
	sta term_sel
	sta rig_stage
	sta rig_k
	sta rig_bar
	+rig_wait RIG_T_OPEN
	jsr rnd8
	and #3
	cmp #3
	bcc .ro_c
	lda #0
.ro_c
	clc
	adc #1
	sta rig_cnt				; 1..3
.ro_p
	jsr rnd8
	and #15
	cmp #CRIME_N
	bcs .ro_p
	ldx rig_k
.ro_d
	dex
	bmi .ro_ok
	cmp rig_c,x
	bne .ro_d
	beq .ro_p				; already picked
.ro_ok
	ldx rig_k
	sta rig_c,x
	inc rig_k
	lda rig_k
	cmp rig_cnt
	bcc .ro_p
	lda #0
	sta rig_k				; reused as the number printed
	rts

; Title only; the rest arrives from r_tick. Row 0 stays blank (seam DLI).
r_draw
	jsr t_rbegin
	lda #<t_s_rig
	ldy #>t_s_rig
	ldx #4					; 23 chars, centred
	jsr t_str
	lda #1
	jmp t_blit

; ------------------------------------------------------------------
; r_tick — once per frame from the terminal loop. Counts rig_wait down by sample_ms; on
; expiry runs the current stage, which sets the next wait.
; ------------------------------------------------------------------
r_tick
	lda rig_stage
	cmp #RIG_DONE
	bcs .rt_rts
	sec
	lda rig_wait_l
	sbc sample_ms
	sta rig_wait_l
	lda rig_wait_h
	sbc #0
	sta rig_wait_h
	bcs .rt_rts				; not expired
	ldx rig_stage				; rts dispatch: handler - 1
	lda rg_hi,x
	pha
	lda rg_lo,x
	pha
.rt_rts
	rts
rg_lo
	!byte <(r_name - 1), <(r_label - 1), <(r_crime - 1), <(r_bounty - 1)
	!byte <(r_stat - 1), <(r_upl - 1), <(r_bar - 1), <(r_pay - 1)
rg_hi
	!byte >(r_name - 1), >(r_label - 1), >(r_crime - 1), >(r_bounty - 1)
	!byte >(r_stat - 1), >(r_upl - 1), >(r_bar - 1), >(r_pay - 1)

r_name
	jsr t_rbegin
	lda #<t_s_rname
	ldy #>t_s_rname
	ldx #1
	jsr t_str
	lda #<rig_name
	ldy #>rig_name
	ldx #9					; after "target: "
	jsr t_str
	lda #3
	jsr t_blit
	inc rig_stage
	+rig_wait RIG_T_NAME
	rts

r_label
	jsr t_rbegin
	lda #<t_s_rcrimes
	ldy #>t_s_rcrimes
	ldx #1
	jsr t_str
	lda #4					; row stays in term_row: r_crime appends to it
	jsr t_blit
	inc rig_stage
	+rig_wait RIG_T_LABEL
	rts

; One crime per tick, comma separated, appended after "crimes:" on row 4 (term_row still
; holds the label) and word-wrapped to row 5 at column 30 (genterminal checks that the three
; longest crimes fit rows 4..5).
r_crime
	ldx rig_k
	bne .rc_go
	lda #4
	sta rig_row
	lda #9					; after "crimes: "
	sta rig_col
	ldx rig_k
.rc_go
	ldy rig_c,x
	lda crime_lo,y
	sta src_ptr
	lda crime_hi,y
	sta src_ptr + 1
	ldy #0
.rc_len
	lda (src_ptr),y
	beq .rc_fit
	iny
	bne .rc_len
.rc_fit
	tya					; A = length
	clc
	adc rig_col
	ldx rig_k
	inx
	cpx rig_cnt
	bcs .rc_end				; last crime: no comma
	adc #1					; C = 0 here
.rc_end
	cmp #32					; item must end at column 30 or earlier
	bcc .rc_put
	inc rig_row				; wrap (col > 1 here: any one crime fits a row)
	jsr t_rbegin
	lda #1
	sta rig_col
.rc_put
	ldx rig_col
	jsr t_puts				; X = column after the name
	lda rig_k
	clc
	adc #1
	cmp rig_cnt
	bcs .rc_nc
	lda #','
	sta term_row,x
	inx
	inx					; comma + space
.rc_nc
	stx rig_col
	lda rig_row
	jsr t_blit
	inc rig_k
	lda rig_k
	cmp rig_cnt
	bcc .rc_more
	inc rig_stage				; 3
	+rig_wait RIG_T_BOUNTY
	rts
.rc_more
	+rig_wait RIG_T_CRIME
	rts

r_bounty
	jsr t_rbegin
	lda #<t_s_rbounty
	ldy #>t_s_rbounty
	ldx #1
	jsr t_str
	jsr r_bits
	ldy #9
	jsr t_num				; 5 digits at columns 9..13
	lda #<t_s_rbits
	ldy #>t_s_rbits
	ldx #15
	jsr t_str
	lda #6
	jsr t_blit
	inc rig_stage
	+rig_wait RIG_T_STAT
	rts

r_stat
	jsr t_rbegin
	lda #<t_s_rstat
	ldy #>t_s_rstat
	ldx #1
	jsr t_str
	lda #8
	jsr t_blit
	inc rig_stage
	+rig_wait RIG_T_UPL
	rts

r_upl
	jsr t_rbegin
	lda #<t_s_rupl
	ldy #>t_s_rupl
	ldx #1
	jsr t_str
	lda #10
	jsr t_blit
	inc rig_stage
	+rig_wait RIG_T_BAR0
	rts

r_bar
	lda rig_bar
	bne .rb_c
	jsr t_rbegin
.rb_c
	jsr rnd8				; erratic: jump 1..4 cells, then a random pause
	and #3
	clc
	adc rig_bar
	adc #1					; C = 0 (sum <= 31)
	cmp #RIG_BAR_N
	bcc .rb_t
	lda #RIG_BAR_N
.rb_t
	sta rig_k				; new fill length (rig_k is free after the crimes)
	ldx rig_bar
	lda #'#'
.rb_f
	sta term_row + 1,x
	inx
	cpx rig_k
	bcc .rb_f
	stx rig_bar
	lda #11
	jsr t_blit
	lda rig_bar
	cmp #RIG_BAR_N
	bcc .rb_w
	inc rig_stage				; 6
	+rig_wait RIG_T_PAY
	rts
.rb_w
	jsr rnd8
	and #15
	asl
	asl
	asl					; 0..120
	clc
	adc #RIG_T_BAR				; + 20 ms floor
	sta rig_wait_l
	lda #0
	sta rig_wait_h
	jsr rnd8				; 1 in 8: a stall of another ~256 ms
	and #7
	bne .rb_x
	inc rig_wait_h
.rb_x
	rts

r_pay
	jsr r_bits
	jsr bits_add
	jsr hud_bits
	ldx rig_idx
	lda #1
	sta en_scan,x
	lda #SOUND_ITEMUP
	jsr play_sound
	jsr t_rbegin
	lda #<t_s_rpaid
	ldy #>t_s_rpaid
	ldx #1
	jsr t_str
	lda #13
	jsr t_blit
	lda #RIG_DONE
	sta rig_stage
	rts

; A = lo, X = hi: bits for the corpse being scanned, 4n-1 (n = en_bty, 1..255).
r_bits
	lda rig_bty
	pha
	lsr
	lsr
	lsr
	lsr
	lsr
	lsr
	tax					; hi = n >> 6
	pla
	asl
	asl					; lo = n << 2
	sec
	sbc #1
	bcs .rbi_ok
	dex					; lo was 0: borrow
.rbi_ok
	rts

; ------------------------------------------------------------------
; r_fire — fire on the scan screen: ignored until the bounty is paid, then close.
; ------------------------------------------------------------------
r_fire
	lda rig_stage
	cmp #RIG_DONE
	bcs .rf_close
	jmp t_loop
.rf_close
	lda #0
	sta term_in
	jmp t_leave
