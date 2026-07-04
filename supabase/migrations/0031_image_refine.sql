-- Blythe Diva — 0031: region-based "Fix a detail" edits on generated images.
--
-- ADDITIVE + IDEMPOTENT + BACKWARD-COMPATIBLE.
--
-- A "refine" is a SURGICAL local edit of an existing candidate: the owner marks the wrong
-- area (e.g. a mis-generated pendant) and types what it should be. The AI edits ONLY that
-- region, re-anchored to the ORIGINAL raw reference, and the result is saved as a NEW
-- candidate linked back to its parent — so nothing is ever overwritten (same rule as 0030).

alter table public.image_generations add column if not exists parent_id        uuid references public.image_generations(id) on delete set null;
alter table public.image_generations add column if not exists edit_instruction text;    -- the owner's correction, e.g. "make the bottom heart an open outline"
alter table public.image_generations add column if not exists edit_region      jsonb;   -- normalised {x,y,w,h} (0..1) of the marked area, or null for a whole-image fix

create index if not exists idx_imggen_parent on public.image_generations(parent_id);
