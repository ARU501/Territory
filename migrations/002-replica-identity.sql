-- ---------------------------------------------------------------------------
-- Make DELETE events reach teammates.
--
-- Under Postgres' default replica identity (the primary key), a DELETE writes
-- only the key column to the WAL. Supabase Realtime evaluates both the
-- subscription filter and RLS against that old record, so a subscription
-- filtered on `team_code=eq.<team>` can never match a delete: the old record
-- has no team_code. The event is silently dropped.
--
-- Symptom this fixes: one rep deletes a territory or a house, and everyone
-- else keeps seeing the stale pins until they reload the page.
--
-- REPLICA IDENTITY FULL puts the whole old row in the WAL. The cost is extra
-- WAL volume per update/delete, which is irrelevant at this table's size.
-- ---------------------------------------------------------------------------

alter table public.territories replica identity full;
alter table public.houses      replica identity full;
