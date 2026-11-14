; DNA rig, resident half (bank-0 code zone). Buying the rig (shop.csv "dna rig") adds
; the scan gear (ABIL_SCAN, space cycles weap / jump / scan). With scan selected, a dead
; enemy that has a bounty (editor: bounty name + bits, en_bty / en_bnm) and has not been
; scanned (en_scan) shows "press fire to scan" on the message row while the player is
; within RIG_R cells on the same floor. Fire opens the green scan screen (terminal_enter,
; term_kind 2 / term_scr 4), which is in segment E (e_rig.asm) and cannot read the map:
; rig_poll copies the bounty name and value into rig_name / rig_bty first.
!zone rig

RIG_MSG_MS	= 200			; prompt lifetime, refreshed every frame while in range

; ------------------------------------------------------------------
; rig_poll — main loop, right after term_poll. Clobbers A, X, Y, rot0.
; ------------------------------------------------------------------
rig_poll
	lda ability_cur
	cmp #ABIL_SCAN
	bne .rp_off
	lda term_in				; inside a real terminal volume: term_poll owns fire
	bne .rp_off
	ldx #0
.rp_l
	cpx map_nenemies
	bcs .rp_off
	lda en_state,x
	cmp #EN_DEAD
	bne .rp_n
	+lda_mx en_bty
	beq .rp_n
	lda en_scan,x
	bne .rp_n
	+lda_mx en_room
	cmp room_idx
	bne .rp_n
	stx enemy_idx
	jsr enemy_same_floor			; C=1 same floor piece
	bcc .rp_nx
	jsr enemy_chebyshev			; A = |dx|,|dz| max in cells
	cmp #RIG_R + 1
	bcc .rp_hit
.rp_nx
	ldx enemy_idx
.rp_n
	inx
	bne .rp_l
.rp_off
	lda #0
	sta rig_arm
	sta rig_shown
	rts

.rp_hit
	ldx enemy_idx
	stx rig_idx
	lda key_fire
	beq .rp_rel
	lda rig_arm				; fire held since before we were in range: no scan
	beq .rp_msg
	lda #0
	sta key_fire
	sta rig_arm
	sta rig_shown
	ldx rig_idx
	+lda_mx en_bty
	sta rig_bty
	+lda_mx en_bnm				; name: offset into the map text blob
	clc
	adc map_text
	sta src_ptr
	lda map_text + 1
	adc #0
	sta src_ptr + 1
	ldy #0
.rp_nm
	lda (src_ptr),y
	sta rig_name,y
	beq .rp_go
	iny
	cpy #RIG_NAME_MAX
	bcc .rp_nm
	lda #0
	sta rig_name,y
.rp_go
	lda #TRIG_RIG
	sta term_in
	jmp terminal_enter			; modal; returns through a8_nmi_on
.rp_rel
	lda #1
	sta rig_arm
.rp_msg
	lda rig_shown
	beq .rp_draw
	lda status_ms_l				; our prompt still up? (a pickup message may have
	ora status_ms_h				; replaced it, or the timer ran out)
	bne .rp_hold
.rp_draw
	jsr hud_msg_blank
	lda #<t_s_rprompt
	sta src_ptr
	lda #>t_s_rprompt
	sta src_ptr + 1
	jsr hud_msg_center
	lda #1
	sta rig_shown
.rp_hold
	lda #RIG_MSG_MS				; update_status blanks the row shortly after we leave
	sta status_ms_l
	lda #0
	sta status_ms_h
	rts

t_s_rprompt
	!text "press fire to scan",0
