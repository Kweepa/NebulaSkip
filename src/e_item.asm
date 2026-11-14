; Item / door mesh tables -> mesh scratch (segment E, sege.asm). The blobs
; (item_blob.asm, tools/genitems.py) sit here too. Callers (mesh.asm) are between
; e_enter and e_leave and stay there through stroke_mesh: xid_ptr, zid_ptr,
; col_ptr, edge_ptr and edge_b point into this segment.
!zone e_item

; Y = slot. rot1 = U/VY scale (0 for items). Fills mesh tables, rot0 = slot.
; Blobs are paged (item_pg): X = page selects the pg_*_lo/hi base, offsets are page-relative.
; X is reloaded at the start of each section (scale_door_u clobbers it).
fill_item_slot
	lda item_nv,y
	sta mesh_nv
	lda item_ne,y
	sta mesh_ne
	lda item_nx,y
	sta mesh_nx
	lda item_nz,y
	sta mesh_nz
	sty rot0
	; UX/UZ stay local (editor 0 = spin centre). World centre is box+ITEM_BIAS.
	ldx item_pg,y
	clc
	lda pg_ux_lo,x
	adc item_uo,y
	sta src_ptr
	lda pg_ux_hi,x
	adc #0
	sta src_ptr+1
	ldy #0
.fi_ux
	cpy mesh_nx
	bcs .fi_uz
	lda (src_ptr),y
	jsr scale_door_u
	sta UX,y
	iny
	bne .fi_ux
.fi_uz
	ldy rot0
	ldx item_pg,y
	clc
	lda pg_uz_lo,x
	adc item_zo,y
	sta src_ptr
	lda pg_uz_hi,x
	adc #0
	sta src_ptr+1
	ldy #0
.fi_uzl
	cpy mesh_nz
	bcs .fi_vy
	lda (src_ptr),y
	sta UZ,y
	iny
	bne .fi_uzl
.fi_vy
	ldy rot0
	ldx item_pg,y
	clc
	lda pg_vy_lo,x
	adc item_vo,y
	sta src_ptr
	lda pg_vy_hi,x
	adc #0
	sta src_ptr+1
	ldy #0
.fi_vyl
	cpy mesh_nv
	bcs .fi_ptr
	lda (src_ptr),y
	jsr scale_door_u
	sta VY,y
	iny
	bne .fi_vyl
.fi_ptr
	ldy rot0
	ldx item_pg,y
	clc
	lda pg_xid_lo,x
	adc item_vo,y
	sta xid_ptr
	lda pg_xid_hi,x
	adc #0
	sta xid_ptr+1
	clc
	lda pg_zid_lo,x
	adc item_vo,y
	sta zid_ptr
	lda pg_zid_hi,x
	adc #0
	sta zid_ptr+1
	clc
	lda pg_col_lo,x
	adc item_vo,y
	sta col_ptr
	lda pg_col_hi,x
	adc #0
	sta col_ptr+1
	clc
	lda pg_ea_lo,x
	adc item_eo,y
	sta edge_ptr
	lda pg_ea_hi,x
	adc #0
	sta edge_ptr+1
	clc
	lda pg_eb_lo,x
	adc item_eo,y
	sta edge_b
	lda pg_eb_hi,x
	adc #0
	sta edge_b+1
	rts

!source "item_blob.asm"
