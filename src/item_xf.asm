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
