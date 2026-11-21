; Thing draw helpers. Segment A (not C/D) because both of those are full.
!zone item_xf

; X/Y preserved. Thing scale: nlo/nhi (8.8 from scale_q4_88) <<= shift, shift = th_draw_fl
; bits 6-7 (0..3 = 1x 2x 4x 8x). th_draw_fl is non-zero only inside fill_item_verts, so doors
; and the bump crack never scale. Wraps past +-127.99 units: keep scaled meshes within
; 127/scale units of origin (63.9 / 31.9 / 15.9).
item_big_shl
	lda th_draw_fl
	and #$c0				; $40 = 2x, $80 = 4x, $c0 = 8x
	beq .ib_rts
	asl nlo
	rol nhi
	cmp #$80
	bcc .ib_rts
	asl nlo
	rol nhi
	cmp #$c0
	bcc .ib_rts
	asl nlo
	rol nhi
.ib_rts
	rts

; Y = item slot. Returns A = ent_rot: yaw-spinning items follow item_spin, static ones hold
; the placed facing (th_draw_fl bits 0-2, x32 = 45 deg steps in 256-unit yaw).
; xform_item_cam rotates by yaw + ent_rot (enemies use yaw - ent_rot), so the facing is
; negated to match the editor / enemy rot convention.
item_pick_rot
	lda item_rot,y
	and #ITEM_FL_ROT
	beq .ip_still
	lda item_spin
	rts
.ip_still
	lda th_draw_fl
	and #7
	asl
	asl
	asl
	asl
	asl
	eor #$ff
	clc
	adc #1
	rts

; Thing frustum test. X = thing index, box_y = th_y, box_x/box_z = th_x/th_z on entry.
; Returns C = frustum_hits for a box of item_cr[slot] half-extent about the world centre
; box+ITEM_BIAS, so a mesh wider than the 2x2 foot box (DNA sign, +-2.5) is not dropped while
; its edge is still in view. box_x/box_z are the item's world position for xform_item_spin, so
; they are restored from th_x/th_z before returning (box_sx/sy/sz are left as the cull box).
; Slot resolution mirrors fill_item_verts. box_sy is borrowed for r-1, then set to TH_FOOT_SY.
; A low-edge underflow clamps to 0 and keeps 2r, which only enlarges the box.
th_cull_hit
	+lda_mx th_type
	cmp #ITEM_DOOR_BASE
	bcc .tc_slot
	lda #0
.tc_slot
	tay
	lda item_nv,y
	bne .tc_r
	ldy #TH_BACKPACK
.tc_r
	lda item_cr,y
	asl
	sta box_sx
	sta box_sz
	lda item_cr,y
	sec
	sbc #1
	sta box_sy				; r-1
	lda box_x
	sec
	sbc box_sy
	bcs .tc_x
	lda #0
.tc_x
	sta box_x
	lda box_z
	sec
	sbc box_sy
	bcs .tc_z
	lda #0
.tc_z
	sta box_z
	lda #TH_FOOT_SY
	sta box_sy
	jsr frustum_hits
	ldx obj_i				; restore the draw position (lda/sta keep C)
	+lda_mx th_x
	sta box_x
	+lda_mx th_z
	sta box_z
	rts

; A = signed local coord. rot1: 0=×1, 1=×3/2, 2=×2. Y preserved.
scale_door_u
	ldx rot1
	beq .sdu_rts
	dex
	beq .sdu_15
	asl
	rts
.sdu_15
	sta pv4
	asl
	clc
	adc pv4
	cmp #$80
	ror
.sdu_rts
	rts

; ---------------------------------------------------------------------------
; Editor spheres (item_ns / item_sv / item_sr, tools/genitems.py). Called right after
; stroke_mesh, inside e_enter: PROJ_X/Y (16-bit, centred), CAM_Z and VOC of every mesh
; vertex are still valid. A sphere origin is one of those vertices (hidden, or an existing
; one the cooker reused), so spin, scale, facing and the near clip come for free.
;
; The circle is Bresenham / midpoint (sph_bres): exact integer R, octant 0..45 degrees, the 8
; mirror points plotted per step, row-grouped (see sph_bres). (Minsky's rotation was tried and
; measured 20-50% slower with more overdraw, so it was dropped.)
; R is the screen radius from persp88: r * FOCAL / z, r = radius << item_scale_shl.
; Hires logical space (192 x 128): plot x is hires >> 1, y = 63 - oy.
item_spheres
	ldy item_slot_cur
	lda item_ns,y
	beq .is_rts
	sta sph_n
	tya
	asl
	sta sph_i
.is_loop
	ldy sph_i
	lda item_sv,y
	sta sph_v
	lda item_sr,y
	sta sph_rq
	jsr sph_one
	inc sph_i
	dec sph_n
	bne .is_loop
.is_rts
	rts

; sph_v = mesh vertex, sph_rq = radius in quarter-units
sph_one
	ldx sph_v
	lda VOC,x
	bpl +
	rts						; behind the near plane
+
	clc
	lda PROJ_X,x
	adc #SCREEN_CX
	sta sph_b
	lda PROJ_XH,x
	adc #0
	sta sph_b+1
	sec
	lda #63
	sbc PROJ_Y,x
	sta sph_b+2
	lda #0
	sbc PROJ_YH,x
	sta sph_b+3
	lda CAM_Z,x
	sta z_eye
	lda CAM_ZH,x
	sta z_eye_h
	; ylo:yhi = rq * 64 << scale shift (8.8 world units), capped below the sign bit
	lda sph_rq
	sta ylo
	lda #0
	sta yhi
	lda item_scale_shl
	clc
	adc #6
	tax
.so_sh
	asl ylo
	rol yhi
	dex
	bne .so_sh
	lda yhi
	bpl .so_proj
	lda #$7f
	sta yhi
	lda #$ff
	sta ylo
.so_proj
	lda #0
	sta sph_red				; ink, sub-pixel circles are skipped

; Shared circle core (items above, projectiles in rocket.asm). In: sph_b = centre (hires x lo/hi,
; screen y lo/hi), z_eye/z_eye_h, ylo:yhi = world radius 8.8, sph_red = 0 ink / 1 red.
; Red forces pixel %10 (a circle cannot eor: its mirrors coincide at y = 0 and x = y) and is
; never culled for size: a far projectile stays a 1px ring.
sph_draw
	; Coarse reject (R <= PERSP_MAX): x centre within -256..511, y within -256..255
	lda sph_b+1
	clc
	adc #1
	cmp #3
	bcc +
	rts
+
	lda sph_b+3
	clc
	adc #1
	cmp #2
	bcc +
	rts
+
	jsr persp88
	cmp #1
	bcs .sd_r
	ldx sph_red
	bne .sd_one
	rts						; sub-pixel
.sd_one
	lda #1
.sd_r
	sta sph_r
	; Bounding-box reject (Elite's CHKON, on our 192 x 128 view): skip when no part can show.
	clc
	lda sph_b
	adc sph_r
	lda sph_b+1
	adc #0
	bmi .so_rj				; cx + R < 0
	clc
	lda sph_b+2
	adc sph_r
	lda sph_b+3
	adc #0
	bmi .so_rj				; cy + R < 0
	sec
	lda sph_b
	sbc sph_r
	tax
	lda sph_b+1
	sbc #0
	bmi .so_xok				; cx - R < 0
	bne .so_rj				; cx - R >= 256
	cpx #192
	bcs .so_rj				; cx - R > 191
.so_xok
	sec
	lda sph_b+2
	sbc sph_r
	tax
	lda sph_b+3
	sbc #0
	bmi .so_yok
	bne .so_rj
	cpx #128
	bcs .so_rj				; cy - R > 127
.so_yok
	lda #<sph_plot8			; ink or red plot stage for this circle
	ldx #>sph_plot8
	ldy sph_red
	beq +
	lda #<sph_plot8r
	ldx #>sph_plot8r
+
	sta sph_p8+1
	stx sph_p8+2
	lda #PORTB_MAIN			; bitmaps are main RAM under the bank window: one switch for the whole circle
	sta $d301
	jsr sph_bres
	lda portb_cur
	sta $d301
.so_rj
	rts

; Bresenham / midpoint circle, octant 0..45 degrees, exact integer radius R = sph_r:
;   x = R, y = 0, d = 1 - R
;   while x >= y: plot 8 mirrors; y++; d < 0 ? d += 2y+1 : (x--, d += 2(y-x)+1)
; d is 16-bit signed (|d| <= ~2R).
;
; The 8 mirrors share four rows and four columns, so each is tracked once and updated
; incrementally instead of rebuilding a screen address per point:
;   rows    R0 = cy+y  R1 = cy-y  R2 = cy+x  R3 = cy-x   as bitmap addresses (sph_pl/ph).
;           Rows are 32 bytes from the page-aligned bitmap, so address = (bmp_hi << 8) + y*32:
;           y++ is +32, and "on screen" is just hi in bmp_hi .. bmp_hi+15.
;   columns C0 = cx+x  C1 = cx-x  C2 = cx+y  C3 = cx-y   as hires x (sph_hl/hh), decoded to a
;           byte offset + pixel mask (sph_cb/cm, offset $ff = off-screen) when they change.
; Per step y++ moves R0, R1, C2, C3; x-- (about 30% of steps) moves R2, R3, C0, C1.
sph_bres
	lda bmp_hi
	clc
	adc #16
	sta sph_bend
	; R0 = (bmp_hi << 8) + cy * 32. cy is within -80..207 after the reject above.
	lda sph_b+2
	sta sph_pl
	lda sph_b+3
	sta sph_ph
	ldx #5
.sb_s5
	asl sph_pl
	rol sph_ph
	dex
	bne .sb_s5
	lda sph_ph
	clc
	adc bmp_hi
	sta sph_ph
	lda sph_pl
	sta sph_pl+1			; R1 = R0 at y = 0
	lda sph_ph
	sta sph_ph+1
	lda sph_r				; R2 = R0 + R*32, R3 = R0 - R*32
	and #7
	asl
	asl
	asl
	asl
	asl
	sta sph_tl
	lda sph_r
	lsr
	lsr
	lsr
	sta sph_th
	clc
	lda sph_pl
	adc sph_tl
	sta sph_pl+2
	lda sph_ph
	adc sph_th
	sta sph_ph+2
	sec
	lda sph_pl
	sbc sph_tl
	sta sph_pl+3
	lda sph_ph
	sbc sph_th
	sta sph_ph+3
	; C0 = cx + R, C1 = cx - R, C2 = C3 = cx
	clc
	lda sph_b
	adc sph_r
	sta sph_hl
	lda sph_b+1
	adc #0
	sta sph_hh
	sec
	lda sph_b
	sbc sph_r
	sta sph_hl+1
	lda sph_b+1
	sbc #0
	sta sph_hh+1
	lda sph_b
	sta sph_hl+2
	sta sph_hl+3
	lda sph_b+1
	sta sph_hh+2
	sta sph_hh+3
	ldx #3
.sb_d
	jsr sph_dec
	dex
	bpl .sb_d
	lda sph_r
	sta sph_ix
	lda #0
	sta sph_iy
	sec
	lda #1
	sbc sph_r
	sta sph_dl
	lda #0
	sbc #0
	sta sph_dh
.sb_loop
sph_p8
	jsr sph_plot8				; operand patched by sph_draw (ink or red)
	inc sph_iy
	clc						; y++: R0 += 32, R1 -= 32
	lda sph_pl
	adc #32
	sta sph_pl
	bcc +
	inc sph_ph
+
	sec
	lda sph_pl+1
	sbc #32
	sta sph_pl+1
	bcs +
	dec sph_ph+1
+
	inc sph_hl+2			; C2 = cx + y, C3 = cx - y
	bne +
	inc sph_hh+2
+
	lda sph_hl+3
	bne +
	dec sph_hh+3
+
	dec sph_hl+3
	ldx #2
	jsr sph_dec
	ldx #3
	jsr sph_dec
	lda sph_dh
	bmi .sb_in
	dec sph_ix				; x--: R2 -= 32, R3 += 32, C0 -= 1, C1 += 1
	sec
	lda sph_pl+2
	sbc #32
	sta sph_pl+2
	bcs +
	dec sph_ph+2
+
	clc
	lda sph_pl+3
	adc #32
	sta sph_pl+3
	bcc +
	inc sph_ph+3
+
	lda sph_hl
	bne +
	dec sph_hh
+
	dec sph_hl
	inc sph_hl+1
	bne +
	inc sph_hh+1
+
	ldx #0
	jsr sph_dec
	ldx #1
	jsr sph_dec
	ldx #0					; d >= 0: d += 2(y - x) + 1 with y - x <= 0
	lda sph_iy
	sec
	sbc sph_ix
	bpl +
	dex						; sign-extend t = y - x
+
	sta sph_tl
	stx sph_th
	asl sph_tl
	rol sph_th
	sec						; +1
	lda sph_dl
	adc sph_tl
	sta sph_dl
	lda sph_dh
	adc sph_th
	sta sph_dh
	jmp .sb_next
.sb_in
	lda sph_iy				; d < 0: d += 2y + 1
	asl
	sec
	adc sph_dl
	sta sph_dl
	bcc .sb_next
	inc sph_dh
.sb_next
	lda sph_ix				; carry = (x >= y)
	cmp sph_iy
	bcc .sb_done
	jmp .sb_loop
.sb_done
	rts

; Decode column X (hires x in sph_hl/hh,x) to a byte offset in the row (sph_cb) and the pixel
; mask (sph_cm). Off-screen (x < 0 or >= 192): offset $ff. Pixel = hires >> 1, byte = pixel >> 2.
sph_dec
	lda sph_hh,x
	bne .dc_bad
	lda sph_hl,x
	cmp #192
	bcs .dc_bad
	sta sph_t
	and #6
	tay
	lda sph_mt,y
	sta sph_cm,x
	lda sph_t
	lsr
	lsr
	lsr
	clc
	adc #BMP_MARGIN
	sta sph_cb,x
	rts
.dc_bad
	lda #$ff
	sta sph_cb,x
	rts

; One row of the plot: colptr = the row address, then each of the two columns that share it.
; A row off the bitmap skips both points; a column off-screen skips its point.
!macro sph_row .k, .ca, .cb {
	lda sph_ph+.k
	cmp bmp_hi
	bcc .sk
	cmp sph_bend
	bcs .sk
	sta colptr+1
	lda sph_pl+.k
	sta colptr
	ldy sph_cb+.ca
	bmi .c2
	lda sph_cm+.ca
	ora (colptr),y
	sta (colptr),y
.c2
	ldy sph_cb+.cb
	bmi .sk
	lda sph_cm+.cb
	ora (colptr),y
	sta (colptr),y
.sk
}

; The 8 mirrors of (x, y): (C0,R0) (C1,R0) (C0,R1) (C1,R1) (C2,R2) (C3,R2) (C2,R3) (C3,R3).
sph_plot8
	+sph_row 0, 0, 1
	+sph_row 1, 0, 1
	+sph_row 2, 2, 3
	+sph_row 3, 2, 3
	rts

; Red stage: same walk, pixel forced to %10 = (bg | M) & ~(M & $55).
!macro sph_red_px .c {
	lda sph_cm+.c
	and #$55
	eor #$ff
	tax
	lda sph_cm+.c
	ora (colptr),y
	stx sph_rm
	and sph_rm
	sta (colptr),y
}

!macro sph_row_red .k, .ca, .cb {
	lda sph_ph+.k
	cmp bmp_hi
	bcc .sk
	cmp sph_bend
	bcs .sk
	sta colptr+1
	lda sph_pl+.k
	sta colptr
	ldy sph_cb+.ca
	bmi .c2
	+sph_red_px .ca
.c2
	ldy sph_cb+.cb
	bmi .sk
	+sph_red_px .cb
.sk
}

sph_plot8r
	+sph_row_red 0, 0, 1
	+sph_row_red 1, 0, 1
	+sph_row_red 2, 2, 3
	+sph_row_red 3, 2, 3
	rts

; Pixel masks by (hires x & 6): pixels 0..3 of a mode E byte, MSB first (a8_pair).
sph_mt
	!byte $c0,0,$30,0,$0c,0,$03

; Named state (segment A is RAM; no ZP aliasing, see .claude/rules/no-zp-alias.md).
item_slot_cur	!byte 0			; slot fill_item_verts last chose
item_scale_shl	!byte 0			; its thing scale shift 0..3
sph_dl		!byte 0			; Bresenham decision variable (16-bit signed)
sph_dh		!byte 0
sph_red		!byte 0			; 0 ink item sphere, 1 red projectile
sph_rm		!byte 0			; red plot scratch: ~(M & $55)
sph_n		!byte 0			; spheres left
sph_i		!byte 0			; item_sv / item_sr index
sph_v		!byte 0
sph_rq		!byte 0
sph_r		!byte 0			; screen radius px
sph_tl		!byte 0
sph_th		!byte 0
sph_ix		!byte 0
sph_iy		!byte 0
sph_t		!byte 0
sph_bend	!byte 0			; bmp_hi + 16: first page past the bitmap
sph_b		!byte 0,0,0,0			; centre x lo/hi, y lo/hi (hires x, screen y)
sph_pl		!byte 0,0,0,0			; rows R0..R3: bitmap address lo / hi
sph_ph		!byte 0,0,0,0
sph_hl		!byte 0,0,0,0			; columns C0..C3: hires x lo / hi
sph_hh		!byte 0,0,0,0
sph_cb		!byte 0,0,0,0			; decoded columns: byte offset in the row ($ff = off) / mask
sph_cm		!byte 0,0,0,0
