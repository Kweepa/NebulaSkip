; Segment E: main RAM $6000-$7FFF, under the bank window and above the two
; bitmaps. Visible only with PORTB_MAIN, which is also when the bitmaps are.
; Loaded as GAMEE by load_game_segments (a8sio.asm) with segments B, C and D.
;
; Assembled on its own after GAME (tools/genesyms.py exports game.lbl into
; esyms.asm), so its labels do not share game.lbl with the bank-0 code zone and
; static data that sit at the same addresses in bank 0.
;
; Rules:
;  - GAME enters through the jmp table below (E_* in mem.asm) between e_enter
;    and e_leave (a8stamp.asm): PORTB and portb_cur are PORTB_MAIN in here, so
;    the screen leaves return to this window.
;  - No map accessors (+lda_mx ...): their patch sites are rewritten at
;    PORTB_PLAY and would land in bank 0. Map columns are read by the caller.
;  - No calls into the bank-0 code zone or static data. Never from NMI.
!cpu 6502
!to "gamee.prg", cbm

!source "build_flags.asm"
!source "mem.asm"
!source "zp.asm"
!source "map_counts.asm"
!source "esyms.asm"

*= SEG_E_BASE
	jmp stamp_view_e		; E_STAMP_VIEW
	jmp terminal_run		; E_TERMINAL
	jmp fill_item_slot		; E_ITEM_SLOT

!source "e_stamp.asm"
!source "e_item.asm"
!source "e_term.asm"
!source "e_ship.asm"
!source "e_rig.asm"
!source "terminal_data.asm"
!source "terminal_text.asm"

seg_e_end = *
!if seg_e_end > SEG_E_LIMIT {
	!error "segment E runs past $8000; end=$", seg_e_end
}
