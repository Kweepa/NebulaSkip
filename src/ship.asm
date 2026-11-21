; Player ship, resident half (segment A). The nebula chart itself is a screen of
; the terminal loop in segment E (e_ship.asm). Here: the visited-map mask, the
; travel that follows a chart pick, and bin16_dec5.
;
; Reachable: the current map and any map in ship_seen (visited, or its bounty was
; accepted at the terminal; permanent, quicksaved). Travel reloads the target map at
; its spawn like next_level does: HP / ammo / weapons / bits are kept, keys are per-map.
!zone ship

; X = node index (map - 1, 0..15) -> bit in ship_seen. Clobbers A, Y.
sh_mark
	txa
	and #7
	tay
	lda barrel_bit,y			; 1 << n (rocket.asm)
	cpx #8
	bcs .sm_h
	ora ship_seen
	sta ship_seen
	rts
.sm_h
	ora ship_seen_h
	sta ship_seen_h
	rts

; ------------------------------------------------------------------
; s_go — X = destination map (1..SHIP_N). s_fire (segment E) has already torn the
; text screen down; put the play window back, then load the map the way
; next_level does. Ends in enter_card, which returns through a8_nmi_on to
; terminal_enter. init_irq (play_up1) rewrites dli_blood+1, so term_blood_sv is
; not restored.
; ------------------------------------------------------------------
s_go
	jsr e_leave				; bank 0 back: restart_level binds the map there
	stx level_num
	dex
	jsr sh_mark
	lda #0
	sta have_keys				; keys are per-map
	jsr restart_level
	bcc .go_ok
	jmp load_fail_hang
.go_ok
	lda #1
	sta den_arm
	jmp enter_card

; ------------------------------------------------------------------
; A = lo, X = hi -> dec5[0..4] ASCII, zero padded. Clobbers A, X. Moved here from
; terminal.asm to free room in segment B. Powers of ten live in code: hud_bits can
; run outside a PORTB_PLAY window.
; ------------------------------------------------------------------
bin16_dec5
	sta d5_lo
	stx d5_hi
	ldx #0
.b5_p
	lda #'0' - 1
	sta dec5,x
.b5_s
	inc dec5,x
	sec
	lda d5_lo
	sbc b5_pw_lo,x
	sta d5_t
	lda d5_hi
	sbc b5_pw_hi,x
	bcc .b5_d
	sta d5_hi
	lda d5_t
	sta d5_lo
	bcs .b5_s				; C set from the sbc
.b5_d
	inx
	cpx #4
	bcc .b5_p
	lda d5_lo
	ora #'0'
	sta dec5 + 4
	rts
b5_pw_lo
	!byte <10000, <1000, <100, <10
b5_pw_hi
	!byte >10000, >1000, >100, >10

; ------------------------------------------------------------------
; bty_apply — unlock the remote door of every accepted bounty / bought shop item whose
; map is the current one (bounties.csv and shop.csv 5th column, baked by genmap.py into
; bty_door.asm). bty_door_bit is the item's bit in the 32-bit mask bounty_acc..shop_owned_h
; (mem.asm: contiguous; bounty i = bit i, shop item i = bit 16+i).
; Idempotent. Needs the map bound, so it runs after world_init and after the
; terminal closes (segment E cannot read the map). Clobbers A, X, Y.
; ------------------------------------------------------------------
bty_apply
	ldx #0
.ba_l
	cpx #BTY_DOOR_N
	bcs .ba_rts
	lda bty_door_map,x
	cmp level_num
	bne .ba_n
	lda bty_door_bit,x
	and #7
	tay
	lda barrel_bit,y			; 1 << n (rocket.asm)
	pha
	lda bty_door_bit,x
	lsr
	lsr
	lsr
	tay
	pla
	and bounty_acc,y
	beq .ba_n
	txa
	pha
	lda bty_door_tag,x
	jsr door_unlock_tag			; clobbers X, Y
	pla
	tax
.ba_n
	inx
	bne .ba_l
.ba_rts
	rts

!source "bty_door.asm"
