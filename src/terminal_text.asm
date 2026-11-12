; DNA terminal read-only tables and text (raw ASCII). Bank 0 static: read only
; with PORTB_PLAY, from the terminal code in segment B (never from NMI).
!zone terminal_text
t_bit
	!byte $01,$02,$04,$08,$10,$20,$40,$80
; ------------------------------------------------------------------
; Text (raw ASCII)
; ------------------------------------------------------------------
t_s_title
	!text "dna terminal",0
t_s_access
	!text "Map access granted.",0
t_s_return
	!text "return",0
t_s_shop
	!text "hardware",0
t_s_bounties
	!text "bounties",0
t_s_quit
	!text "quit",0
t_s_h_item
	!text "item",0
t_s_h_bounty
	!text "bounty",0
t_s_h_bits
	!text "  bits",0
t_s_h_diff
	!text "danger",0
t_paper
	!byte TERM_PAPER_DNA, TERM_PAPER_SHIP	; indexed by term_kind
; Ship chart (ship.asm)
t_s_ship
	!text "nebula chart",0
t_s_unk
	!text "???",0
t_s_locked
	!text "route locked",0
t_s_here
	!text "disembark - you are here",0
t_s_go
	!text "travel",0
t_mi_lo
	!byte <t_s_shop, <t_s_bounties, <t_s_quit
t_mi_hi
	!byte >t_s_shop, >t_s_bounties, >t_s_quit
t_hl_lo
	!byte <t_s_h_item, <t_s_h_bounty
t_hl_hi
	!byte >t_s_h_item, >t_s_h_bounty
t_hr_lo
	!byte <t_s_h_bits, <t_s_h_diff
t_hr_hi
	!byte >t_s_h_bits, >t_s_h_diff
