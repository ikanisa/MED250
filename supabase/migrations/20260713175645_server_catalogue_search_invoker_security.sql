-- Reconstructed from the exact statement retained in the production migration
-- ledger. This preserves a reproducible local history for fresh environments.
alter function public.dawanear_search_catalogue(
  text, text, text, text, text, text, integer, integer
) security invoker;
