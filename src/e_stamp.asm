; Viewport stamps: pistol, muzzle flash, crosshair, enemy muzzle, splat.
; Segment E (sege.asm): runs with PORTB_MAIN, so the rects below and both
; bitmaps are visible together and a rect blends straight into the bitmap.
;
; One rect per graphic: x_byte, y, width, height, then row-major bytes.
; Bodies are inverted (ink %00, clear %11) and ANDed, so the gun is black.
; Flashes, splats, and the enemy muzzle are ink %11. ORA paints line colour;
; red writes pixel %10 (COLPF1). X is phase 0 (a multiple of 8 hires).
!zone e_stamp

stamp_x		!byte 0
stamp_xh	!byte 0
stamp_y		!byte 0
stamp_w		!byte 0
stamp_h		!byte 0
stamp_xb	!byte 0
stamp_red	!byte 0			; 1 = pixel %10
stamp_bl	!byte 0			; world-sprite byte column, signed
stamp_bh	!byte 0
stamp_tmp	!byte 0
stamp_y0	!byte 0			; viewport Y restored by stamp_at_x
stamp_splat_ok	!byte 0			; splat_track said the splat is on screen

OP_AND_IY	= $31			; and (zp),y
OP_ORA_IY	= $11			; ora (zp),y

; LOD 0..2 of the enemy muzzle, then of the splat. emuz_src / splat_src hold the
; index (weapon.asm start_world_spr).
e_spr_lo
	!byte <spr_emuz_0, <spr_emuz_1, <spr_emuz_2
	!byte <spr_splat_0, <spr_splat_1, <spr_splat_2
e_spr_hi
	!byte >spr_emuz_0, >spr_emuz_1, >spr_emuz_2
	!byte >spr_splat_0, >spr_splat_1, >spr_splat_2

; A = 1 if the world-anchored splat is on screen this frame (stamp_view in
; a8stamp.asm ran splat_track in bank 0 before switching the window).
; Fire mode: the pistol and its muzzle flash. Jump / scan mode: the black crosshair at
; the viewport centre instead. World effects (enemy muzzle, splat) draw in all.
stamp_view_e
	sta stamp_splat_ok
	lda ability_cur
	beq .sv_wpn
	lda #<spr_xhair_b
	sta init_ptr
	lda #>spr_xhair_b
	sta init_ptr+1
	lda #0
	sta stamp_xb			; header x_byte / y are absolute viewport coords
	sta stamp_y
	sta stamp_red
	lda #OP_AND_IY
	jsr blit_rect
	jmp .sv_fx
.sv_wpn
	jsr wpn_y_bob
	sec
	sbc #VIEW_SPR_Y0
	sta stamp_y0
	lda #WPN_X0
	jsr stamp_at_x
	lda #<spr_pist_b
	sta init_ptr
	lda #>spr_pist_b
	sta init_ptr+1
	lda #0
	sta stamp_red
	lda #OP_AND_IY
	jsr blit_rect
	lda flash_phase
	beq .sv_fx
	lda #<spr_muzzle_b
	sta init_ptr
	lda #>spr_muzzle_b
	sta init_ptr+1
	lda flash_phase
	jsr stamp_flash
.sv_fx
	lda emuz_on
	beq .noe
	lda emuz_vx
	ldx emuz_xmsb
	jsr stamp_set_xmsb
	lda emuz_vy
	jsr stamp_set_y
	jsr stamp_emuz
.noe
	lda splat_on
	beq .nos
	lda stamp_splat_ok
	beq .nos
	lda splat_vx
	ldx splat_xmsb
	jsr stamp_set_xmsb
	lda splat_vy
	jsr stamp_set_y
	jsr stamp_splat
.nos
	rts

; init_ptr set. A is the phase (1 = line colour, 2 = red). X is absolute,
; so the anchor byte is 0 and the header x_byte is the viewport column.
stamp_flash
	ldx #0
	cmp #2
	bne .yel
	inx
.yel
	stx stamp_red
	lda #0
	sta stamp_xb
	jsr wpn_y_bob
	sec
	sbc #VIEW_SPR_Y0
	sta stamp_y
	lda #OP_ORA_IY
	jmp blit_rect

; A = screen X. Restores the saved viewport Y.
stamp_at_x
	sec
	sbc #VIEW_SPR_X0
	lsr
	lsr
	lsr
	sta stamp_xb
	lda stamp_y0
	sta stamp_y
	rts

; A = wpn_y plus the walk bob. Phase 0 (rest, firing, airborne) adds 0.
; (SINTAB[0..127] + 8) >> 5 is 0 at rest and 4 at the crest.
wpn_y_bob
	ldy wpn_bob_ph
	lda SINTAB,y
	clc
	adc #8
	lsr
	lsr
	lsr
	lsr
	lsr
	clc
	adc wpn_y
	rts

; init_ptr = one rect, A = blend opcode (OP_AND_IY / OP_ORA_IY; ignored when
; stamp_red). stamp_xb / stamp_y are the anchor; the header x_byte and y are
; added. Rows at y >= 128 are skipped so a stock can hang off the bottom.
; Row address as a8_addr: the bitmaps are page aligned on a 4K boundary and
; (y & 7) << 5 + margin + column <= 251, so the low byte never carries.
blit_rect
	sta .op
	ldy #0
	lda (init_ptr),y
	clc
	adc stamp_xb
	adc #BMP_MARGIN
	sta stamp_xb			; byte column inside the 32-byte row
	iny
	lda (init_ptr),y
	clc
	adc stamp_y
	sta stamp_y
	iny
	lda (init_ptr),y
	sta stamp_w
	iny
	lda (init_ptr),y
	sta stamp_h
	clc
	lda init_ptr
	adc #4
	sta src_ptr
	lda init_ptr+1
	adc #0
	sta src_ptr+1
.row
	lda stamp_y
	bmi .adv
	asl
	asl
	asl
	asl
	asl
	clc
	adc stamp_xb
	sta dst_ptr
	lda stamp_y
	lsr
	lsr
	lsr
	ora bmp_hi
	sta dst_ptr+1
	ldy stamp_w
	dey
	lda stamp_red
	bne .red
.blend
	lda (dst_ptr),y
.op	and (src_ptr),y			; opcode patched per rect
	sta (dst_ptr),y
	dey
	bpl .blend
.adv
	clc
	lda src_ptr
	adc stamp_w
	sta src_ptr
	bcc .src_ok
	inc src_ptr+1
.src_ok
	inc stamp_y
	dec stamp_h
	bne .row
	rts
.red
	lda (src_ptr),y
	sta stamp_tmp
	and #$55
	pha
	lda (dst_ptr),y
	ora stamp_tmp
	sta stamp_tmp
	pla
	eor stamp_tmp
	sta (dst_ptr),y
	dey
	bpl .red
	bmi .adv

; A = VIC x, X = msb flag (nonzero → +256)
stamp_set_xmsb
	sec
	sbc #VIEW_SPR_X0
	sta stamp_x
	lda #0
	sbc #0
	cpx #1
	bcc .nm
	clc
	adc #1
.nm
	sta stamp_xh
	rts

; A = VIC y
stamp_set_y
	sec
	sbc #VIEW_SPR_Y0
	sta stamp_y
	rts

; Enemy muzzle. Always pixel %10. Anchor is the uncropped 24×21.
stamp_emuz
	ldx emuz_src
	lda e_spr_lo,x
	sta init_ptr
	lda e_spr_hi,x
	sta init_ptr+1
	lda #1
	sta stamp_red
	jmp stamp_anchor

; Splat. Hit writes %10. Miss ORs. Same uncropped anchor as the muzzle.
stamp_splat
	ldx splat_src
	lda e_spr_lo,x
	sta init_ptr
	lda e_spr_hi,x
	sta init_ptr+1
	lda #0
	sta stamp_red
	lda splat_col
	cmp #COL_SPLAT_HIT
	bne stamp_anchor
	inc stamp_red

; Snap the uncropped left (tip − EMUZ_OX, already in stamp_x) to a byte
; and keep that 24×21 box inside the viewport. blit_rect then adds the
; header crop, so the ink stays on the tip.
stamp_anchor
	clc
	lda stamp_x
	adc #4
	sta stamp_bl
	lda stamp_xh
	adc #0
	sta stamp_bh
	ldx #3
-
	lda stamp_bh
	cmp #$80
	ror stamp_bh
	ror stamp_bl			; signed (hires+4)>>3, nearest byte
	dex
	bne -
	lda stamp_bh
	bmi .xlo
	bne .xhi
	lda stamp_bl
	cmp #BMP_DRAW_W-2		; 3 bytes must end by column 23
	bcc .xin
.xhi
	lda #BMP_DRAW_W-3
	sta stamp_xb
	jmp .yfix
.xlo
	lda #0
	sta stamp_xb
	jmp .yfix
.xin
	lda stamp_bl
	sta stamp_xb
.yfix
	lda stamp_y
	bpl .ypos
	lda #0
	sta stamp_y
	beq .go
.ypos
	cmp #128-20
	bcc .go
	lda #128-21
	sta stamp_y
.go
	lda #OP_ORA_IY
	jmp blit_rect

!source "weapon_spr.asm"
!source "splat_spr.asm"
!source "enemy_muzzle.asm"
