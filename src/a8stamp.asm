; Gateway to segment E (sege.asm): main RAM under the bank window. The stamp
; code and its rects live there (e_stamp.asm), next to the bitmaps they blend into.
!zone a8stamp

; Window -> main RAM for code that calls into or reads segment E. portb_cur
; follows, so the screen leaves (draw_line, ...) come back to this window.
; Bank 0 (map columns, code zone, static data) is not reachable until e_leave.
; A, X, Y and C kept.
e_enter
	pha
	lda #PORTB_MAIN
	sta portb_cur
	sta $d301
	pla
	rts

e_leave
	pha
	lda #PORTB_PLAY
	sta portb_cur
	sta $d301
	pla
	rts

; Pistol / crosshair, enemy muzzle, splat. splat_track is bank-0 code, so it
; runs first and its verdict rides in A.
stamp_view
	lda #0
	ldx splat_on
	beq .sv_go
	jsr splat_track			; world-anchored: re-project for this frame's camera
	lda #0
	rol				; 1 = on screen
.sv_go
	jsr e_enter
	jsr E_STAMP_VIEW
	jmp e_leave
