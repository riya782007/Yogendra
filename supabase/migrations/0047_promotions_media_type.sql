-- Support owner-uploaded promo creatives that can be an image OR a video.
alter table public.promotions add column if not exists media_type text not null default 'image';
