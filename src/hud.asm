; 40-col HUD — Doom 8×8 font in UI charset $F800 (ASCII screen codes)
; Single-buffered in matrix A. Raster HUD / flyback always D018_A_UI; the
; viewport still flips A/B. Colour RAM is shared.
!zone hud

init_hud
	; Seven stored rows, 280 bytes. Not sta $0200,x — hi $02 is the
	; map reloc sentinel. The tail is $0300.
	lda #<HUD_SCR
	sta init_ptr
	lda #>HUD_SCR
	sta init_ptr+1
	lda #HUD_CH_SP
	ldy #0
-	sta (init_ptr),y
	iny
	bne -
	ldx #0
-	sta HUD_SCR + 256,x
	inx
	cpx #24					; 256 + 24 = 7 * 40
	bne -

	ldx #0

	lda #<HUD_SCR + HUD_OFF_TITLE + HUD_TITLE_COL
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF_TITLE + HUD_TITLE_COL
	sta init_ptr+1

-	lda hud_str_title,x
	beq +

	jsr hud_stax


	inx
	bne -
+
	ldy #0
-	+lda_my map_name
	beq +
	iny
	cpy #HUD_MSG_W
	bcc -
+	sty hud_n
	lda #HUD_MSG_W
	sec
	sbc hud_n
	lsr
	tax
	ldy #0

	lda #<HUD_SCR + HUD_OFF_MAP
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF_MAP
	sta init_ptr+1

.imap
	+lda_my map_name
	beq .imap_done

	jsr hud_stax


	inx
	iny
	cpy #HUD_MSG_W
	bcc .imap
.imap_done

	ldx #0					; bits label over its value, like health / shield

	lda #<HUD_SCR + HUD_OFF_LABEL + HUD_BITS_COL
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF_LABEL + HUD_BITS_COL
	sta init_ptr+1

-	lda hud_str_bits,x
	beq +

	jsr hud_stax


	inx
	bne -
+
	ldx #0

	lda #<HUD_SCR + HUD_OFF_LABEL + HUD_HP_LABEL
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF_LABEL + HUD_HP_LABEL
	sta init_ptr+1

-	lda hud_str_health,x
	beq +

	jsr hud_stax


	inx
	bne -
+
	ldx #0

	lda #<HUD_SCR + HUD_OFF_LABEL + HUD_AR_LABEL
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF_LABEL + HUD_AR_LABEL
	sta init_ptr+1

-	lda hud_str_armour,x
	beq +

	jsr hud_stax


	inx
	bne -
+
	ldx #0					; "gear" over the fire / jump ability

	lda #<HUD_SCR + HUD_OFF_LABEL + HUD_ABIL_COL
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF_LABEL + HUD_ABIL_COL
	sta init_ptr+1

-	lda hud_str_gear,x
	beq +

	jsr hud_stax


	inx
	bne -
+


!if  PROFILE = 1 {
	lda #HUD_CH_R
	sta HUD_SCR + HUD_OFF + 4
	lda #HUD_CH_P
	sta HUD_SCR + HUD_OFF + 9
	lda #HUD_CH_K
	sta HUD_SCR + HUD_OFF + 14
	lda #HUD_CH_D
	sta HUD_SCR + HUD_OFF + 19
	lda #HUD_CH_C
	sta HUD_SCR + HUD_OFF + 24
	lda #HUD_CH_U
	sta HUD_SCR + HUD_OFF + 29


	lda #HUD_CH_R
	sta HUD_SCR + HUD_OFF_MAP
	lda #HUD_CH_P
	sta HUD_SCR + HUD_OFF_MAP + 4
	lda #HUD_CH_K
	sta HUD_SCR + HUD_OFF_MAP + 8


}

!if  HUD_POS = 1 {
	lda #HUD_CH_X
	sta HUD_SCR + HUD_OFF2
	lda #HUD_CH_Y
	sta HUD_SCR + HUD_OFF2 + 5
	lda #HUD_CH_Z
	sta HUD_SCR + HUD_OFF2 + 10
	lda #HUD_CH_H
	sta HUD_SCR + HUD_OFF2 + 15
	lda #HUD_CH_P
	sta HUD_SCR + HUD_OFF2 + 19


}
	jmp hud_keys

; X = column, A = char. init_ptr = row base. Saves Y. Not abs,x (map sentinel).

hud_stax
	sta hud_ch
	tya
	pha
	txa
	tay
	lda hud_ch
	sta (init_ptr),y
	pla
	tay
	lda hud_ch
	rts
hud_ch	!byte 0

; Rows 0 and 1 while DMA is off. The blank line between them is enter_dl.
; Verb line: the map's own string (second NUL-terminated string after
; map_name, e.g. "docking at"), or "entering" (8 wide, column 16) if empty.
hud_enter_rows
	lda #<HUD_SCR
	sta init_ptr
	lda #>HUD_SCR
	sta init_ptr+1
	ldy #0
	lda #HUD_CH_SP
.er_sp
	sta (init_ptr),y
	iny
	cpy #80
	bcc .er_sp

	ldy #0					; skip map_name, Y = verb offset
.er_vo
	+lda_my map_name
	beq .er_vo0
	iny
	bne .er_vo
.er_vo0
	iny
	ldx #0					; X = verb length
.er_vl
	+lda_my map_name
	beq .er_vl0
	iny
	inx
	bne .er_vl
.er_vl0
	stx hud_n
	cpx #0					; stx leaves Z from the NUL test
	beq .er_def
	tya						; back to verb start
	sec
	sbc hud_n
	pha
	lda #HUD_MSG_W
	sec
	sbc hud_n
	lsr
	tax
	pla
	tay
.er_vc
	+lda_my map_name
	beq .er_nm
	jsr hud_stax
	inx
	iny
	bne .er_vc				; NUL-bounded, never wraps
.er_def
	ldx #16
	ldy #0
.er_en
	lda hud_str_entering,y
	beq .er_nm
	jsr hud_stax
	inx
	iny
	bne .er_en
.er_nm
	ldy #0
.er_len
	+lda_my map_name
	beq .er_got
	iny
	cpy #HUD_MSG_W
	bcc .er_len
.er_got
	sty hud_n
	lda #HUD_MSG_W
	sec
	sbc hud_n
	lsr
	tax
	ldy #0
	lda #<HUD_SCR + HUD_OFF_MAP
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF_MAP
	sta init_ptr+1
.er_cp
	+lda_my map_name
	beq .er_done
	jsr hud_stax
	inx
	iny
	cpy #HUD_MSG_W
	bcc .er_cp
.er_done
	rts

; Row 0: R/P/K/D/C/U milliseconds. D is unused (lines are inside K).
; C is clear. U is everything after the last clip.
; Map line: R/P/K vertex and edge counts.
hud_print
!if  HUD_FRAME_MS = 1 {
	ldx #0
	lda dt_msh
	ldy dt_ms
	jsr .dec3
}
!if  PROFILE = 1 {
	ldx #5
	lda prof_cy + PROF_ROT * 4 + 2
	ldy prof_cy + PROF_ROT * 4 + 1
	jsr .ms4
	ldx #10
	lda prof_cy + PROF_PROJ * 4 + 2
	ldy prof_cy + PROF_PROJ * 4 + 1
	jsr .ms4
	ldx #15
	lda prof_cy + PROF_CLIP * 4 + 2
	ldy prof_cy + PROF_CLIP * 4 + 1
	jsr .ms4
	ldx #20
	lda prof_cy + PROF_DRAW * 4 + 2
	ldy prof_cy + PROF_DRAW * 4 + 1
	jsr .ms4
	ldx #25
	lda prof_cy + PROF_CLEAR * 4 + 2
	ldy prof_cy + PROF_CLEAR * 4 + 1
	jsr .ms4
	ldx #30
	lda prof_cy + PROF_UPDATE * 4 + 2
	ldy prof_cy + PROF_UPDATE * 4 + 1
	jsr .ms4

	ldx #1
	lda nv_rot + 1
	ldy nv_rot
	jsr .dec3n
	ldx #5
	lda nv_proj + 1
	ldy nv_proj
	jsr .dec3n
	ldx #9
	lda nv_clip + 1
	ldy nv_clip
	jsr .dec3n
}
!if  HUD_POS = 1 {
	ldx #1
	lda cam_xh
	jsr .s8_3
	ldx #6
	lda cam_yh
	jsr .s8_3
	ldx #11
	lda cam_zh
	jsr .s8_3
	ldx #16
	lda yaw
	jsr .u8_3
	ldx #20
	lda pitch
	jsr .s8_3
}
	rts

; Current joystick-button ability, 4 chars. Absolute stores (hi $02 sentinel).
hud_ability
	lda ability_cur
	asl
	asl
	tax
	lda hud_str_abil,x
	sta HUD_SCR + HUD_OFF_VALUE + HUD_ABIL_COL
	lda hud_str_abil + 1,x
	sta HUD_SCR + HUD_OFF_VALUE + HUD_ABIL_COL + 1
	lda hud_str_abil + 2,x
	sta HUD_SCR + HUD_OFF_VALUE + HUD_ABIL_COL + 2
	lda hud_str_abil + 3,x
	sta HUD_SCR + HUD_OFF_VALUE + HUD_ABIL_COL + 3
	rts

; Bits + health + shield (+ ability label); ammo is not drawn.
; Call on init, spend, backpack, damage — not every frame.
hud_ammo
	jsr hud_ability
	jsr hud_bits				; ammo is not shown; its variables and plumbing stay
	lda #<HUD_SCR + HUD_OFF_VALUE + HUD_HP_NUM
	sta dst_ptr
	lda #>HUD_SCR + HUD_OFF_VALUE + HUD_HP_NUM
	sta dst_ptr+1
	lda player_hp
	jsr .u8_3at
	lda #<HUD_SCR + HUD_OFF_VALUE + HUD_AR_NUM
	sta dst_ptr
	lda #>HUD_SCR + HUD_OFF_VALUE + HUD_AR_NUM
	sta dst_ptr+1
	lda player_armour
	; fall through

; A unsigned -> 3 ASCII digits at (dst_ptr)+0..2.
; Hundreds in X, tens in Y, both start at '0' (jsw PrintDec3).
.u8_3at
	ldx #$30
.u8h
	cmp #100
	bcc .u8t
	sbc #100
	inx
	bcs .u8h
.u8t
	ldy #$30
.u8tl
	cmp #10
	bcc .u8o
	sbc #10
	iny
	bne .u8tl
.u8o
	pha
	tya
	pha
	txa
	ldy #0
	sta (dst_ptr),y
	pla
	ldy #1
	sta (dst_ptr),y
	pla
	ora #$30
	ldy #2
	sta (dst_ptr),y
	rts

!if  HUD_POS = 1 {
; A signed → sign + 3 digits at HUD_OFF2+X (horizon pitch = 0)
.s8_3
	ldy #HUD_CH_PLUS
	cmp #0
	bpl .spos
	ldy #HUD_CH_MINUS
	eor #$ff
	clc
	adc #1
.spos
	pha
	tya
	ldy #0
	jsr .u8_ptr
	sta (dst_ptr),y
	inc dst_ptr
	bne .s8d
	inc dst_ptr+1
.s8d
	pla
	jmp .u8_3at

; A unsigned → 3 ASCII digits at HUD_OFF2+X
.u8_3
	jsr .u8_ptr
	jmp .u8_3at

; X = column. dst_ptr = HUD_SCR+HUD_OFF2+X. Preserves A and Y.
.u8_ptr
	pha
	clc
	txa
	adc #<HUD_SCR + HUD_OFF2
	sta dst_ptr
	lda #>HUD_SCR + HUD_OFF2
	adc #0
	sta dst_ptr+1
	pla
	rts
}

!if  PROFILE = 1 {
; A:Y = cy[2]:cy[1] → ms (>>2) then 4 digits at HUD_OFF+X
.ms4
	sta pp_tmp_h
	sty pp_tmp_l
	lsr pp_tmp_h
	ror pp_tmp_l
	lsr pp_tmp_h
	ror pp_tmp_l
	lda pp_tmp_h
	ldy pp_tmp_l
	; fall through

; A:Y = 16-bit → 4 ASCII digits at HUD_OFF+X; saturate 9999
.dec4
	stx pp_col
	sta pp_tmp_h
	sty pp_tmp_l
	cmp #>10000
	bcc .d4go
	bne .d4sat
	cpy #<10000
	bcc .d4go
.d4sat
	lda #$39
	sta hud_n
	sta pp_tmp_h
	sta pp_tmp_l
	ldy #$39
	jmp .d4out
.d4go
	ldx #0
.d4thou
	lda pp_tmp_h
	cmp #>1000
	bcc .d4hund
	bne .d4tsub
	lda pp_tmp_l
	cmp #<1000
	bcc .d4hund
.d4tsub
	sec
	lda pp_tmp_l
	sbc #<1000
	sta pp_tmp_l
	lda pp_tmp_h
	sbc #>1000
	sta pp_tmp_h
	inx
	bne .d4thou
.d4hund
	stx hud_n			; thousands 0–9
	ldx #0
.d4hlp
	lda pp_tmp_h
	bne .d4hsub
	lda pp_tmp_l
	cmp #100
	bcc .d4tens
.d4hsub
	sec
	lda pp_tmp_l
	sbc #100
	sta pp_tmp_l
	lda pp_tmp_h
	sbc #0
	sta pp_tmp_h
	inx
	bne .d4hlp
.d4tens
	ldy #0
.d4tlp
	lda pp_tmp_l
	cmp #10
	bcc .d4ones
	sbc #10
	sta pp_tmp_l
	iny
	bne .d4tlp
.d4ones
	txa
	ora #$30
	sta pp_tmp_h			; hundreds ASCII
	tya
	ora #$30
	tay				; tens ASCII
	lda hud_n
	ora #$30
	sta hud_n			; thousands ASCII
	lda pp_tmp_l
	ora #$30
	sta pp_tmp_l			; ones ASCII
.d4out
	ldx pp_col

	lda #<HUD_SCR + HUD_OFF
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF
	sta init_ptr+1
	lda hud_n
	jsr hud_stax
	inx
	lda pp_tmp_h
	jsr hud_stax
	inx
	tya
	jsr hud_stax
	inx
	lda pp_tmp_l
	jmp hud_stax

}

; A:Y = 16-bit → 3 ASCII digits; saturate 999. .dec3 → HUD_OFF, .dec3n → map line
!if  HUD_FRAME_MS = 1 {
.dec3
	stx pp_col
	jsr .d3conv

	lda #<HUD_SCR + HUD_OFF
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF
	sta init_ptr+1
	ldx pp_col
	lda hud_n
	jsr hud_stax
	inx
	lda pp_tmp_h
	jsr hud_stax
	inx
	lda pp_tmp_l
	jmp hud_stax

}
!if  PROFILE = 1 {
.dec3n
	stx pp_col
	jsr .d3conv
	ldx pp_col

	lda #<HUD_SCR + HUD_OFF3
	sta init_ptr
	lda #>HUD_SCR + HUD_OFF3
	sta init_ptr+1
	lda hud_n
	jsr hud_stax
	inx
	lda pp_tmp_h
	jsr hud_stax
	inx
	lda pp_tmp_l
	jmp hud_stax

}
!if  HUD_FRAME_MS + PROFILE > 0 {
.d3conv
	sta pp_tmp_h
	sty pp_tmp_l
	cmp #>1000
	bcc .d3go
	bne .d3sat
	cpy #<1000
	bcc .d3go
.d3sat
	lda #$39
	sta hud_n
	sta pp_tmp_h
	sta pp_tmp_l
	rts
.d3go
	ldx #0
.d3hlp
	lda pp_tmp_h
	bne .d3hsub
	lda pp_tmp_l
	cmp #100
	bcc .d3tens
.d3hsub
	sec
	lda pp_tmp_l
	sbc #100
	sta pp_tmp_l
	lda pp_tmp_h
	sbc #0
	sta pp_tmp_h
	inx
	bne .d3hlp
.d3tens
	stx hud_n
	ldy #0
.d3tlp
	lda pp_tmp_l
	cmp #10
	bcc .d3ones
	sbc #10
	sta pp_tmp_l
	iny
	bne .d3tlp
.d3ones
	lda hud_n
	ora #$30
	sta hud_n
	tya
	ora #$30
	sta pp_tmp_h
	lda pp_tmp_l
	ora #$30
	sta pp_tmp_l
	rts
}

; Message trigger on HUD_ROW4, centered. Call on enter/leave only.
hud_message
	lda #0
	sta status_ms_l
	sta status_ms_h
	lda msg_on
	bne .hm_show
	jmp hud_msg_blank
.hm_show
	jsr hud_msg_blank
	clc
	lda	map_text
	adc msg_off
	sta src_ptr
	lda	map_text+1
	adc #0
	sta src_ptr+1
	jmp hud_msg_center

hud_msg_blank
	ldx #0
	lda #HUD_CH_SP
.hmb
	sta HUD_SCR + HUD_OFF4,x
	inx
	cpx #HUD_MSG_W
	bne .hmb
	rts

; src_ptr → NUL string, already blanked, centered on HUD_OFF4
hud_msg_center
	ldy #0
.hm_len
	lda (src_ptr),y
	beq .hm_got
	iny
	cpy #HUD_MSG_W
	bcc .hm_len
.hm_got
	sty hud_n			; length
	lda #HUD_MSG_W
	sec
	sbc hud_n
	lsr
	tax				; dest col = (W - len) / 2
	ldy #0
.hm_cp
	lda (src_ptr),y
	beq .hm_done
	sta HUD_SCR + HUD_OFF4,x
	inx
	iny
	cpy #HUD_MSG_W
	bcc .hm_cp
.hm_done
	rts

; One keycard glyph per colour: blue and yellow on the keys row, red on the values row.
; Only A is touched (callers keep X/Y).
hud_keys
	lda #HUD_CH_SP
	sta HUD_SCR + HUD_OFF_KEYS + HUD_KEY_COL_BLU
	sta HUD_SCR + HUD_OFF_KEYS + HUD_KEY_COL_YEL
	sta HUD_SCR + HUD_OFF_VALUE + HUD_KEY_COL_RED
	lda have_keys
	and #HAVE_BLUE
	beq +
	lda #HUD_CH_KEY_BLU
	sta HUD_SCR + HUD_OFF_KEYS + HUD_KEY_COL_BLU
+
	lda have_keys
	and #HAVE_YELLOW
	beq +
	lda #HUD_CH_KEY_YEL
	sta HUD_SCR + HUD_OFF_KEYS + HUD_KEY_COL_YEL
+
	lda have_keys
	and #HAVE_RED
	beq +
	lda #HUD_CH_KEY_RED
	sta HUD_SCR + HUD_OFF_VALUE + HUD_KEY_COL_RED
+
	rts

; A = TH_* type. "You got the <name>" for 5s on HUD_ROW4.
hud_got
	cmp #TH_NTYPES
	bcc .hg_ok
	rts
.hg_ok
	sta rot2
	tay
	lda th_name_lo,y
	sta src_ptr
	lda th_name_hi,y
	sta src_ptr+1
	jsr hud_msg_blank
	ldy #0
.hg_nl
	lda (src_ptr),y
	beq .hg_nlen
	iny
	cpy #HUD_MSG_W
	bcc .hg_nl
.hg_nlen
	tya
	clc
	adc #HUD_GOT_LEN
	sta hud_n
	lda #HUD_MSG_W
	sec
	sbc hud_n
	lsr
	tax
	ldy #0
.hg_pre
	lda hud_str_got,y
	beq .hg_name
	sta HUD_SCR + HUD_OFF4,x
	inx
	iny
	bne .hg_pre
.hg_name
	ldy #0
.hg_cp
	lda (src_ptr),y
	beq .hg_arm
	sta HUD_SCR + HUD_OFF4,x
	inx
	iny
	bne .hg_cp
.hg_arm
	lda #<STATUS_MS
	sta status_ms_l
	lda #>STATUS_MS
	sta status_ms_h
	rts

; A = DOOR_KEY_YELLOW / DOOR_KEY_BLUE / DOOR_KEY_RED / DOOR_KEY_REMOTE.
hud_key_req
	cmp #DOOR_KEY_REMOTE
	beq .hkr_remote
	cmp #DOOR_KEY_BLUE
	beq .hkr_blue
	cmp #DOOR_KEY_RED
	beq .hkr_red
	lda #<hud_str_yellow_req
	sta src_ptr
	lda #>hud_str_yellow_req
	sta src_ptr+1
	jmp .hkr_show
.hkr_blue
	lda #<hud_str_blue_req
	sta src_ptr
	lda #>hud_str_blue_req
	sta src_ptr+1
	jmp .hkr_show
.hkr_red
	lda #<hud_str_red_req
	sta src_ptr
	lda #>hud_str_red_req
	sta src_ptr+1
	jmp .hkr_show
.hkr_remote
	lda #<hud_str_remote_req
	sta src_ptr
	lda #>hud_str_remote_req
	sta src_ptr+1
.hkr_show
	jsr hud_msg_blank
	jsr hud_msg_center
	lda #<STATUS_MS
	sta status_ms_l
	lda #>STATUS_MS
	sta status_ms_h
	rts

; Tick status line; blank and clear msg_on when the timer expires.
update_status
	lda status_ms_l
	ora status_ms_h
	beq .us_rts
	sec
	lda status_ms_l
	sbc dt_ms
	sta status_ms_l
	lda status_ms_h
	sbc dt_msh
	sta status_ms_h
	bcs .us_rts
	lda #0
	sta status_ms_l
	sta status_ms_h
	sta msg_on
	jmp hud_msg_blank
.us_rts
	rts

HUD_GOT_LEN	= 12			; "You got the "
hud_str_got	!text "You got the ",0
hud_str_yellow_req	!text "You need a "
	!byte HUD_CH_KEY_YEL
	!text " keycard",0
hud_str_blue_req	!text "You need a "
	!byte HUD_CH_KEY_BLU
	!text " keycard",0
hud_str_red_req	!text "You need a "
	!byte HUD_CH_KEY_RED
	!text " keycard",0
hud_str_remote_req	!text "This door is opened elsewhere",0
; th_name_lo/hi + thn_* strings: generated from the editor item names (item_mesh.asm, tools/genitems.py)

; ASCII (UI charset), not PETSCII
hud_str_title	!text "Nebula Skip",0
hud_str_entering	!text "entering",0
hud_str_abil	!text "weapjump"		; ABIL_* x 4
hud_str_health	!text "health",0
hud_str_armour	!text "shield",0
hud_str_bits	!text "bits",0
hud_str_gear	!text "gear",0
