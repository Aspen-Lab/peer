-- The private Supabase Storage bucket that holds readers' uploaded PDFs when
-- Peer runs on Vercel (web/src/lib/papers/upload-backend.ts). Set
-- PEER_UPLOAD_BUCKET=private-uploads (with PEER_UPLOADS_ENABLED=true and
-- SUPABASE_SERVICE_ROLE_KEY) in the deployment to use it.
--
-- Private, and no storage.objects policies on purpose: only the server, with
-- the service-role key, reads, writes, lists or deletes here. A reader's
-- browser writes exactly one object at a time, through a one-time signed
-- upload URL the server issues for that reader's own `incoming/` folder —
-- that needs no policy either. The anon and authenticated keys can do
-- nothing in this bucket.
--
-- 25 MiB per object matches the upload route's own cap. The bucket holds the
-- PDFs, their JSON records (application/json) and empty owner-index markers
-- (text/plain); nothing else is accepted.
--
-- Idempotent: safe to run on a project where the bucket was already created
-- from the dashboard or the API.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-uploads',
  'private-uploads',
  false,
  26214400,
  array['application/pdf', 'application/json', 'text/plain']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
