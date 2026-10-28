-- Database file 19: switch on the document vault. From now on every file is sent to the doc-vault function, which
-- encrypts it before storage (see supabase/functions/doc-vault). Run this only after doc-vault is deployed and its
-- DOC_VAULT_KEY secret is set: with the vault on, uploads stop rather than store a file unencrypted.
insert into private.features (name) values ('vault') on conflict do nothing;
