-- Phase 3 (#7/#33/#28): variants gain explicit size & polish; a self-growing master
-- list of colour/size/polish values powers datalist suggestions in the admin.
alter table public.variants add column if not exists size text;
alter table public.variants add column if not exists polish text;

create table if not exists public.variant_options (
  id uuid primary key default extensions.uuid_generate_v4(),
  kind text not null check (kind in ('color','size','polish')),
  value text not null,
  sort int not null default 0,
  created_at timestamptz default now(),
  unique (kind, value)
);
alter table public.variant_options enable row level security;
drop policy if exists variant_options_read on public.variant_options;
create policy variant_options_read on public.variant_options for select using (true);

insert into public.variant_options(kind,value,sort) values
 ('color','Gold',1),('color','Silver',2),('color','Rose Gold',3),('color','Oxidised',4),
 ('color','Green',5),('color','Red',6),('color','Blue',7),('color','Pink',8),
 ('color','White',9),('color','Black',10),('color','Maroon',11),('color','Multicolour',12),
 ('size','Small',1),('size','Medium',2),('size','Large',3),('size','Free Size',4),
 ('size','2.4',5),('size','2.6',6),('size','2.8',7),('size','2.10',8),
 ('polish','Gold',1),('polish','Silver',2),('polish','Rose Gold',3),('polish','Oxidised',4),
 ('polish','Antique',5),('polish','Matte',6),('polish','High Polish',7),('polish','Dual Tone',8)
on conflict (kind,value) do nothing;
