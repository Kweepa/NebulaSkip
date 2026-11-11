; Jukebox. All tracks are embedded in the menu (music/menu_tunes.asm, played by
; a8music.asm); switching is a player restart, no disk access.

!zone menu_music

!if  JUKEBOX {
; run_menu, before menu_sfx_init: random track on entry (POKEY RANDOM).
music_pick
	lda $d20a
.mp_mod
	cmp #MUSIC_TRACKS
	bcc .mp_ok
	sbc #MUSIC_TRACKS			; C already set
	bcs .mp_mod
.mp_ok
	sta music_track
	rts

; A = track 0..MUSIC_TRACKS-1, menu VBI live. Silences, restarts, repaints.
jukebox_select
	sta music_track
	jsr a8_music_stop
	lda music_track
	jsr a8_music_start
	jsr sync_juke_title
	jmp draw_menu

; Jukebox heading follows music_track (menu id 3).
sync_juke_title
	ldx music_track
	lda juke_now_lo,x
	sta section_lo + 3
	lda juke_now_hi,x
	sta section_hi + 3
	rts
}
