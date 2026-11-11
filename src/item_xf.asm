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
