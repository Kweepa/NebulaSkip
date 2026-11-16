; Ambient tune on POKEY channel 4 (AUDF4 / AUDC4), the voice the SFX mixer
; leaves free. One voice, AUDCTL 0 (64 kHz, 8-bit). The tune is part of the
; packed map (map_tune, bind_map; library in tools/genambient.py, picked per
; map in the editor), so it sits in the bank-0 heap: amb_get maps PORTB_PLAY
; for the one read and puts PORTB back, whatever the interrupted code had.
;
; Tune: tick_ms, dist|peak, atk, rel, rel_ticks, vib_delay, vib_speed,
; vib_depth, glide, hold, then (AUDF, len) pairs.
;   len 1..127 ticks. Bit 7 = rest (gate off, AUDF ignored). len 0 = loop.
;   Level is 4.4: rises by atk per VBI to peak<<4, falls by rel per VBI once
;   rel_ticks or fewer ticks are left (rel_ticks 0 = legato) and in rests.
;   rel 0 = one level every other VBI.
;   Vibrato: vib_delay VBIs after a note starts, AUDF goes 0, +depth, 0,
;   -depth, vib_speed VBIs each (depth 0 = off). Divider steps, so the
;   width in cents grows with pitch.
;   Glide: a note that starts while the last one still sounds slides there,
;   glide divider steps per VBI (0 = jump).
;   Hold (4.4): the level stops falling there instead of at 0, so the last
;   note of a group carries on quietly through the rest (0 = silence).
; Ticks are counted in sample_ms, so PAL and NTSC keep the same tempo.
;
; amb_tick runs in the VBI: no ZP, X/Y free (a8_nmi saved them). Segment A.

!zone ambient

amb_on		!byte 0
amb_acc		!byte 0			; ms toward the next tick
amb_tick_ms	!byte 0
amb_dist	!byte 0			; AUDC distortion bits
amb_peak	!byte 0			; 4.4
amb_atk		!byte 0
amb_rel		!byte 0
amb_relt	!byte 0
amb_left	!byte 0			; ticks left in this note / rest
amb_gate	!byte 0
amb_lvl		!byte 0			; 4.4
amb_f		!byte 0			; divider now (glides to amb_tgt)
amb_tgt		!byte 0
amb_glide	!byte 0
amb_hold	!byte 0			; 4.4
amb_half	!byte 0			; rel 0: falls on odd counts
amb_vdelay	!byte 0
amb_vspeed	!byte 0
amb_vdep	!byte 0
amb_vt		!byte 0			; VBIs since the note started, up to vdelay
amb_vc		!byte 0
amb_vph		!byte 0
amb_v		!byte 0
amb_m		!byte 0
amb_start_l	!byte 0			; first note pair (loop target)
amb_start_h	!byte 0

; This map's tune, from the top (after bind_map). Channel silent until the
; first tick, and for good when the map has no tune.
.ai_no
	rts
amb_init
	lda #0
	sta amb_on
	sta $d207
	lda map_tune + 1
	beq .ai_no
	sta amb_rd + 2
	lda map_tune
	sta amb_rd + 1
	jsr amb_get
	sta amb_tick_ms
	jsr amb_get
	pha
	and #$f0
	sta amb_dist
	pla
	asl
	asl
	asl
	asl
	sta amb_peak
	jsr amb_get
	sta amb_atk
	jsr amb_get
	sta amb_rel
	jsr amb_get
	sta amb_relt
	jsr amb_get
	sta amb_vdelay
	jsr amb_get
	sta amb_vspeed
	jsr amb_get
	sta amb_vdep
	jsr amb_get
	sta amb_glide
	jsr amb_get
	sta amb_hold
	lda amb_rd + 1
	sta amb_start_l
	lda amb_rd + 2
	sta amb_start_h
	lda #0
	sta amb_acc
	sta amb_lvl
	sta amb_gate
	sta amb_f
	sta amb_tgt
	sta amb_vt
	sta amb_vc
	sta amb_vph
	sta amb_half
	lda #1
	sta amb_left				; first tick fetches the first pair
	sta amb_on
.ai_rts
	rts

amb_tick
	lda amb_on
	beq .ai_rts
	clc
	lda amb_acc
	adc sample_ms
	bcs .step				; past 255: tick_ms is 8-bit, so a tick is due
	cmp amb_tick_ms
	bcs .step
	sta amb_acc
	bcc .env
.step
	sbc amb_tick_ms				; tick_ms >= sample_ms: one tick at most
	sta amb_acc
	dec amb_left
	bne .env
.next
	jsr amb_get
	tax
	jsr amb_get
	cmp #0					; flags from the byte (amb_get ends on its inc)
	bne .have
	lda amb_start_l
	sta amb_rd + 1
	lda amb_start_h
	sta amb_rd + 2
	bne .next				; tunes are never in page 0
.have
	bmi .rest
	sta amb_left
	stx amb_tgt
	lda amb_glide
	beq .jump
	lda amb_lvl				; from silence there is nothing to slide from
	bne .slide
.jump
	stx amb_f
.slide
	lda #0					; vibrato comes back in after its delay
	sta amb_vt
	sta amb_vc
	sta amb_vph
	lda #1
	sta amb_gate
	bne .env
.rest
	and #$7f
	sta amb_left
	lda #0
	sta amb_gate				; amb_f stays: the tail keeps its pitch
.env
	lda amb_gate
	beq .fall
	lda amb_relt
	cmp amb_left
	bcs .fall
	clc
	lda amb_lvl
	adc amb_atk
	bcs .top
	cmp amb_peak
	bcc .set
.top
	lda amb_peak
	bcs .set
.fall
	lda amb_lvl
	cmp amb_hold
	bcc .set				; under the hold level only before the first note
	beq .set
	ldx amb_rel				; C = 1 from here on
	bne .fr
	inc amb_half
	lda amb_half
	lsr
	lda amb_lvl
	bcc .set
	sbc #1					; lvl > hold >= 0: no borrow
	bcs .set
.fr
	sbc amb_rel
	bcc .floor
	cmp amb_hold
	bcs .set
.floor
	lda amb_hold
.set
	sta amb_lvl
	lsr
	lsr
	lsr
	lsr
	sta amb_v
	lda effects_vol				; menu SFX level scales the tune too
	and #$0f
	cmp #$0f
	beq .vfull
	clc
	adc #1
	sta amb_m
	lda #0
	ldy #4
.ml
	lsr amb_m
	bcc .mn
	clc
	adc amb_v
.mn
	asl amb_v
	dey
	bne .ml
	lsr
	lsr
	lsr
	lsr
	sta amb_v
.vfull
	lda amb_v
	ora amb_dist
	sta $d207
	lda amb_f				; glide: amb_glide steps toward the target
	cmp amb_tgt
	beq .gd
	bcc .gup
	sbc amb_glide				; C = 1
	bcc .gt
	cmp amb_tgt
	bcs .gs
.gt
	lda amb_tgt
	bcc .gs					; both ways in have C = 0
.gup
	adc amb_glide				; C = 0
	bcs .gt2
	cmp amb_tgt
	bcc .gs
.gt2
	lda amb_tgt
.gs
	sta amb_f
.gd
	ldx amb_vdep
	beq .vout
	ldx amb_vt
	cpx amb_vdelay
	bcs .von
	inc amb_vt
	bne .vout				; vt < vdelay <= 255
.von
	inc amb_vc
	ldx amb_vc
	cpx amb_vspeed
	bcc .vk
	ldx #0
	stx amb_vc
	inc amb_vph
.vk
	lda amb_vph
	and #3
	tax
	lda amb_f
	dex					; phase 1: + depth
	bne .v3
	clc
	adc amb_vdep
	bcc .vw					; genambient keeps AUDF +- depth in 0..255
.v3
	dex
	dex					; phase 3: - depth
	bne .vw
	sec
	sbc amb_vdep
.vw
	sta $d206
	rts
.vout
	lda amb_f
	sta $d206
	rts

; Next tune byte in A. X kept, Y clobbered. PORTB reads back its output latch.
amb_get
	ldy $d301
	lda #PORTB_PLAY
	sta $d301
amb_rd
	lda $ffff
	sty $d301
	inc amb_rd + 1
	bne .ag
	inc amb_rd + 2
.ag
	rts
