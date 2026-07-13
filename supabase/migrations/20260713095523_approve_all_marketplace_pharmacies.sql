begin;

alter table public.dawanear_pharmacies
  alter column marketplace_approved set default true;

update public.dawanear_pharmacies
set marketplace_approved = true
where not marketplace_approved;

comment on column public.dawanear_pharmacies.marketplace_approved is
  'Automatically true for every MED+250 pharmacy; operational eligibility remains controlled by active licence, location, and channel checks.';

commit;
