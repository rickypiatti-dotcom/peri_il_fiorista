#!/bin/sh
# Ruoli usati da PostgREST: anon (visitatori), authenticated (staff loggato).
# La password di "authenticator" arriva da variabile d'ambiente, mai scritta nel repository.
set -e
psql -v ON_ERROR_STOP=1 -v pw="$AUTHENTICATOR_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
create role anon nologin;
create role authenticated nologin;
create role authenticator login noinherit password :'pw';
grant anon, authenticated to authenticator;
EOSQL
