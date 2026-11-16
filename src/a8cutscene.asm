; Map-arrival cutscene player. Assembled at CUT_BASE (the empty bank-0 static block) and loaded
; there on demand: disk file CUT<letter> = this code + that map's baked data (tools/gencutscene.py
; appends it at cut_data). cut_arrive (loader.asm) loads it and calls CUT_BASE from enter_card, so
; start / next_level / ship travel play it and death restart / quickload do not. The code is gone
; with the next map's load; maps without a cutscene never load it.
; Build: after the reloc assemble of GAME (gencutsyms.py reads game.lbl).
;
; Runs with PORTB_PLAY like main, NMI on, den_arm = 1 (view held blank until the first frame is
; published). It does what main's draw half does for a fixed camera: the cutscene room becomes
; room_idx, the camera actor drives cam_* / yaw, draw_world strokes the room, then every item
; actor is drawn through cut_draw_item (loader.asm: the e_enter / e_leave bracket has to sit in
; resident code, the window shows main RAM inside it). No enemies, rockets, weapon or input.
; Fire (a fresh press, not the one that started the game) skips. On the way out room_idx, the
; camera and the room palette go back to the spawn view world_init built.
;
; Baked data (cut_data, offsets CD_*; gencutscene.py writes it, actor 0 is the camera):
;   0 room   1 nact   2,3 duration ms
;   4 kind[6] ($FF camera, else item slot)  10 scale[6] (shift)  16 ns[6]  22 offl[6]  28 offh[6]
;   34.. per actor, SoA: xl[ns] xh[ns] yl[ns] yh[ns] zl[ns] zh[ns] yaw[ns]   (8.8 world, yaw 0..255)
; Playback: i = t >> 7 (128 ms samples), f = (t & 127) << 1; position and shortest-arc yaw are
; linear between sample i and i+1. Items get ITEM_BIAS on X/Z like placed pickups; the camera
; position is the eye.
!cpu 6502
!to "cutscn.prg", cbm

!source "build_flags.asm"
!source "mem.asm"
!source "zp.asm"
!source "map_counts.asm"
!source "map_bss.asm"
!source "cutsyms.asm"
!zone a8cutscene

CD_ROOM		= 0
CD_NACT		= 1
CD_DUR		= 2
CD_KIND		= 4
CD_SCALE	= 10
CD_NS		= 16
CD_OFFL		= 22
CD_OFFH		= 28
CD_STARS	= 34

*= CUT_BASE

cut_run
	lda room_idx
	sta cu_room
	lda cam_xl
	sta cu_sv
	lda cam_xh
	sta cu_sv+1
	lda cam_yl
	sta cu_sv+2
	lda cam_yh
	sta cu_sv+3
	lda cam_zl
	sta cu_sv+4
	lda cam_zh
	sta cu_sv+5
	lda yaw
	sta cu_sv+6
	lda cut_data+CD_ROOM
	sta room_idx
	jsr apply_room_palette
	lda #0
	sta pitch
	sta cu_tl
	sta cu_th
	sta cu_arm
	sta in_fire
	lda vbi_count_l			; the load took a while: dt starts from here
	sta vbi_last_l
	lda vbi_count_h
	sta vbi_last_h
.frame
	jsr cut_pose
	lda #$ff
	sta mesh_vmask
	jsr draw_world_prep		; as main: hull transform before waiting for the old frame
	jsr wait_draw_free
	jsr clear_draw
	jsr cut_stars
	jsr draw_world
	jsr cut_draw_actors
	lda draw_buf
	sta show_buf
	jsr apply_show
	lda den_arm
	cmp #1				; hold the view blank until this frame is published
	bne .den_pub
	lda #2
	sta den_arm
.den_pub
	jsr calc_frame_dt
	lda draw_buf
	eor #1
	sta draw_buf
	jsr set_draw_ptrs
	clc
	lda cu_tl
	adc dt_ms
	sta cu_tl
	lda cu_th
	adc dt_msh
	sta cu_th
	lda in_fire			; read and clear; held fire keeps re-latching it
	ldx #0
	stx in_fire
	cmp #0
	bne .fire
	inx
	stx cu_arm			; fire seen released: the next press skips
	bne .tcheck
.fire
	lda cu_arm
	bne .done
.tcheck
	lda cu_th
	cmp cut_data+CD_DUR+1
	bcc .again
	bne .done
	lda cu_tl
	cmp cut_data+CD_DUR
	bcs .done
.again
	jmp .frame
.done
	lda cu_room
	sta room_idx
	lda cu_sv
	sta cam_xl
	lda cu_sv+1
	sta cam_xh
	lda cu_sv+2
	sta cam_yl
	lda cu_sv+3
	sta cam_yh
	lda cu_sv+4
	sta cam_zl
	lda cu_sv+5
	sta cam_zh
	lda cu_sv+6
	sta yaw
	jmp apply_room_palette		; spawn room's colours again; rts to cut_arrive's caller

; Every actor's pose at time cu_th:cu_tl into cu_tab, then actor 0 (the camera) into cam_* / yaw.
cut_pose
	lda cu_tl
	and #$7f
	asl
	sta cu_frac			; (t & 127) << 1
	lda cu_tl
	asl				; C = bit 7
	lda cu_th
	rol
	sta cu_idx			; t >> 7 (t <= 16000: fits)
	ldx #0
.actor
	stx cu_a
	lda cut_data+CD_NS,x
	sta cu_ns
	clc
	lda cut_data+CD_OFFL,x
	adc #<cut_data
	sta cu_pl
	lda cut_data+CD_OFFH,x
	adc #>cut_data
	sta cu_ph
	ldx cu_ns
	dex
	stx cu_last			; ns - 1
	lda cu_frac
	sta cu_f
	lda cu_idx
	cmp cu_last
	bcc .mid
	lda cu_last			; at or past the last sample (also every ns = 1 actor)
	sta cu_i
	sta cu_i1
	lda #0
	sta cu_f
	beq .have
.mid
	sta cu_i
	clc
	adc #1
	sta cu_i1
.have
	lda cu_a
	sta cu_ti
	lda #3
	sta cu_ax
.axis
	jsr cut_rd2			; low byte channel
	sta cu_v0l
	stx cu_v1l
	jsr cut_adv
	jsr cut_rd2			; high byte channel
	sta cu_v0h
	stx cu_v1h
	jsr cut_adv
	sec				; signed 8.8 delta (< 128 units, the cooker checks)
	lda cu_v1l
	sbc cu_v0l
	sta cu_dl
	lda cu_v1h
	sbc cu_v0h
	sta cu_dh
	jsr cut_mulf			; delta * f / 256
	ldx cu_ti
	clc
	lda cu_v0l
	adc cu_dl
	sta cu_tab,x
	lda cu_v0h
	adc cu_dh			; carry from the low byte
	sta cu_p0
	txa
	clc
	adc #6
	tax
	lda cu_p0
	sta cu_tab,x
	clc
	lda cu_ti
	adc #12
	sta cu_ti
	dec cu_ax
	bne .axis
	jsr cut_rd2			; yaw channel
	sta cu_v0l
	stx cu_v1l
	txa
	sec
	sbc cu_v0l			; shortest arc: the signed byte difference
	sta cu_sgn
	bpl .ypos
	eor #$ff
	clc
	adc #1
.ypos
	jsr cut_mul8			; A = |d| * f >> 8
	ldx cu_sgn
	bpl .yadd
	eor #$ff
	clc
	adc #1
.yadd
	clc
	adc cu_v0l
	ldx cu_a
	sta cu_tab+36,x
	inx
	cpx cut_data+CD_NACT
	bcs .posed
	jmp .actor
.posed
	lda cu_tab
	sta cam_xl
	lda cu_tab+6
	sta cam_xh
	lda cu_tab+12
	sta cam_yl
	lda cu_tab+18
	sta cam_yh
	lda cu_tab+24
	sta cam_zl
	lda cu_tab+30
	sta cam_zh
	lda cu_tab+36
	sta yaw
	rts

; A = sample[cu_i], X = sample[cu_i1] of the channel at cu_pl/cu_ph (the operands are patched).
cut_rd2
	lda cu_pl
	sta .r0+1
	sta .r1+1
	lda cu_ph
	sta .r0+2
	sta .r1+2
	ldy cu_i1
.r1	ldx $ffff,y
	ldy cu_i
.r0	lda $ffff,y
	rts

; Next channel: pointer += ns.
cut_adv
	clc
	lda cu_pl
	adc cu_ns
	sta cu_pl
	bcc .ca_rts
	inc cu_ph
.ca_rts
	rts

; (cu_dh:cu_dl signed) * cu_f / 256, truncated toward zero, back in cu_dh:cu_dl.
cut_mulf
	lda cu_dh
	sta cu_sgn
	bpl .abs
	sec
	lda #0
	sbc cu_dl
	sta cu_dl
	lda #0
	sbc cu_dh
	sta cu_dh
.abs
	lda cu_dl
	jsr cut_mul8
	sta cu_p0			; bits 8..15 of dl * f
	lda cu_dh
	jsr cut_mul8			; A = hi, cu_m = lo of dh * f
	tax
	clc
	lda cu_m
	adc cu_p0
	sta cu_dl
	txa
	adc #0
	sta cu_dh
	lda cu_sgn
	bpl .mf_rts
	sec
	lda #0
	sbc cu_dl
	sta cu_dl
	lda #0
	sbc cu_dh
	sta cu_dh
.mf_rts
	rts

; A * cu_f -> A = high byte, cu_m = low byte.
cut_mul8
	sta cu_m
	lda #0
	ldx #8
	lsr cu_m
.ml
	bcc .mn
	clc
	adc cu_f
.mn
	ror
	ror cu_m
	dex
	bne .ml
	rts

; Starfield (CD_STARS = star count, 0 = off; same spec as cutStars in cutsceneModel.js). A 16-bit
; xorshift from seed $ACE1 (cut_rng) is stepped twice per star: the first value is a fresh position
; (azimuth = high byte, row = low byte >> 1), the second picks the size class and clumping. Half the
; stars (second low byte bit 2 clear) are instead placed near the previous star: azimuth +-8 ticks,
; row +-8 (mod 128), offsets from bits 3..6 of the second low / high byte. k = second high byte & 7:
; 0 plus, 1..2 vertical pair, else dot. With d = az - yaw (signed byte) a star shows for -32..31 at
; colour-clock column 48 + d + d/2. plot_pixel clips and does the bank switch itself; it leaves x0/y0
; alone.
cut_stars
	lda cut_data+CD_STARS
	bne .st_go
	rts
.st_go
	sta cu_sn
	lda #$e1
	sta cu_ssl
	lda #$ac
	sta cu_ssh
	lda #0
	sta cu_pa
	sta cu_py
.st_lp
	jsr cut_rng
	lda cu_ssh
	sta cu_az
	lda cu_ssl
	lsr
	sta cu_ry
	jsr cut_rng
	lda cu_ssl
	and #4
	bne .st_fresh			; fresh position
	lda cu_ssl			; near the previous star
	lsr
	lsr
	lsr
	and #15
	clc
	adc cu_pa
	sec
	sbc #8
	sta cu_az
	lda cu_ssh
	lsr
	lsr
	lsr
	and #15
	clc
	adc cu_py
	sec
	sbc #8
	and #127
	sta cu_ry
.st_fresh
	lda cu_az
	sta cu_pa
	lda cu_ry
	sta cu_py
	lda cu_ssh
	and #7
	sta cu_sk
	lda cu_az
	sec
	sbc yaw
	tax
	clc
	adc #32
	cmp #64
	bcc .st_vis
	jmp .st_nx			; outside -32..31
.st_vis
	txa
	cmp #$80
	ror				; d >> 1, sign kept
	sta x0
	txa
	clc
	adc x0
	clc
	adc #48
	sta x0
	lda cu_ry
	sta y0
	jsr plot_pixel
	lda cu_sk
	beq .st_plus
	cmp #3
	bcs .st_nx
	inc y0				; pair: the row below
	jsr plot_pixel
	jmp .st_nx
.st_plus
	inc x0
	jsr plot_pixel
	dec x0
	dec x0
	jsr plot_pixel
	inc x0
	dec y0
	jsr plot_pixel
	inc y0
	inc y0
	jsr plot_pixel
.st_nx
	dec cu_sn
	beq .st_rts
	jmp .st_lp
.st_rts
	rts

; One xorshift16 step on cu_ssh:cu_ssl: x ^= x << 7; x ^= x >> 9; x ^= x << 8.
cut_rng
	lda cu_ssh
	lsr
	lda cu_ssl
	ror
	tax
	lda #0
	ror
	eor cu_ssl
	sta cu_ssl
	txa
	eor cu_ssh
	sta cu_ssh
	lda cu_ssh
	lsr
	eor cu_ssl
	sta cu_ssl
	lda cu_ssl
	eor cu_ssh
	sta cu_ssh
	rts

; Items are actors 1..nact-1: facing is the negated yaw (xform_item_cam adds it to the view yaw).
cut_draw_actors
	ldx #1
.da
	cpx cut_data+CD_NACT
	bcs .da_rts
	stx cu_a
	lda cu_tab+36,x
	eor #$ff
	clc
	adc #1
	sta ent_rot
	lda cu_tab,x
	sta org_xl
	lda cu_tab+6,x
	clc
	adc #ITEM_BIAS
	sta org_xh
	lda cu_tab+12,x
	sta org_yl
	lda cu_tab+18,x
	sta org_yh
	lda cu_tab+24,x
	sta org_zl
	lda cu_tab+30,x
	clc
	adc #ITEM_BIAS
	sta org_zh
	ldy cut_data+CD_SCALE,x
	lda cut_data+CD_KIND,x
	jsr cut_draw_item
	ldx cu_a
	inx
	bne .da
.da_rts
	rts

; Overlay state. It lives in the image, so every load starts it zeroed.
cu_room		!byte 0
cu_sv		!fill 7, 0
cu_tl		!byte 0
cu_th		!byte 0
cu_arm		!byte 0
cu_frac		!byte 0
cu_idx		!byte 0
cu_a		!byte 0
cu_ns		!byte 0
cu_last		!byte 0
cu_f		!byte 0
cu_i		!byte 0
cu_i1		!byte 0
cu_ti		!byte 0
cu_ax		!byte 0
cu_pl		!byte 0
cu_ph		!byte 0
cu_v0l		!byte 0
cu_v0h		!byte 0
cu_v1l		!byte 0
cu_v1h		!byte 0
cu_dl		!byte 0
cu_dh		!byte 0
cu_sgn		!byte 0
cu_p0		!byte 0
cu_m		!byte 0
cu_sn		!byte 0
cu_ssl		!byte 0
cu_ssh		!byte 0
cu_sk		!byte 0
cu_pa		!byte 0
cu_py		!byte 0
cu_az		!byte 0
cu_ry		!byte 0
cu_tab		!fill 42, 0		; xl[6] xh[6] yl[6] yh[6] zl[6] zh[6] yaw[6]

; The image ends here; gencutscene.py appends the map's data.
cut_data
