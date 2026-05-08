export const relayPostgresMigrations = [
  {
    id: "0001_relay_metadata",
    sql: `
create table if not exists users (
  id text primary key,
  email text not null unique,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists login_challenges (
  id text primary key,
  email text not null,
  device_label text not null,
  code_salt text not null,
  code_hash text not null,
  attempts integer not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  verified_at timestamptz
);

create table if not exists user_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  device_id text not null,
  token_salt text not null,
  token_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists devices (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  label text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists passkey_credentials (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  device_id text not null references devices(id) on delete cascade,
  webauthn_user_id text not null,
  credential_id text not null unique,
  public_key text not null,
  counter integer not null,
  transports text[] not null default '{}',
  backed_up boolean not null default false,
  created_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists passkey_challenges (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  session_id text references user_sessions(id) on delete cascade,
  device_id text references devices(id) on delete cascade,
  purpose text not null,
  challenge text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists hosts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  label text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists host_pairing_intents (
  id text primary key,
  user_id text references users(id) on delete cascade,
  host_id text references hosts(id) on delete set null,
  host_label text not null,
  device_code_salt text not null,
  device_code_hash text not null,
  status text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  approved_at timestamptz,
  registration_token_id text,
  registration_token_expires_at timestamptz
);

create table if not exists host_grants (
  id text primary key,
  host_id text not null references hosts(id) on delete cascade,
  device_id text not null references devices(id) on delete cascade,
  scope text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists host_registration_tokens (
  id text primary key,
  host_id text not null references hosts(id) on delete cascade,
  token_salt text not null,
  token_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz,
  revoked_at timestamptz
);

create table if not exists host_statuses (
  host_id text primary key references hosts(id) on delete cascade,
  state text not null,
  connected_at timestamptz,
  disconnected_at timestamptz,
  connection_id text
);

create table if not exists audit_events (
  id text primary key,
  action text not null,
  actor_user_id text references users(id) on delete set null,
  host_id text references hosts(id) on delete set null,
  device_id text references devices(id) on delete set null,
  request_id text,
  stream_id text,
  status_code integer,
  byte_count integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists user_sessions_user_id_idx on user_sessions(user_id);
create index if not exists passkey_credentials_user_id_idx on passkey_credentials(user_id);
create index if not exists passkey_challenges_user_id_idx on passkey_challenges(user_id);
create index if not exists devices_user_id_idx on devices(user_id);
create index if not exists hosts_user_id_idx on hosts(user_id);
create index if not exists login_challenges_email_created_at_idx on login_challenges(email, created_at desc);
create index if not exists host_pairing_intents_user_id_idx on host_pairing_intents(user_id);
create index if not exists host_registration_tokens_host_id_idx on host_registration_tokens(host_id);
create index if not exists audit_events_host_id_created_at_idx on audit_events(host_id, created_at desc);
`,
  },
  {
    id: "0002_secure_public_relay",
    sql: `
alter table user_sessions add column if not exists auth_method text;
alter table user_sessions add column if not exists last_seen_at timestamptz;
alter table user_sessions add column if not exists step_up_expires_at timestamptz;

update user_sessions
set auth_method = coalesce(auth_method, 'email-recovery'),
    last_seen_at = coalesce(last_seen_at, created_at)
where auth_method is null
   or last_seen_at is null;

alter table user_sessions alter column auth_method set default 'email-recovery';
alter table user_sessions alter column auth_method set not null;
alter table user_sessions alter column last_seen_at set not null;

alter table devices add column if not exists trust_state text;
alter table devices add column if not exists last_seen_at timestamptz;
alter table devices add column if not exists trusted_at timestamptz;

update devices
set trust_state = coalesce(trust_state, case when revoked_at is null then 'recovery' else 'revoked' end),
    last_seen_at = coalesce(last_seen_at, created_at)
where trust_state is null
   or last_seen_at is null;

alter table devices alter column trust_state set default 'recovery';
alter table devices alter column trust_state set not null;
alter table devices alter column last_seen_at set not null;

alter table hosts add column if not exists host_key_id text;
alter table hosts add column if not exists host_public_key_pem text;
alter table hosts add column if not exists host_key_algorithm text;
alter table hosts add column if not exists host_key_updated_at timestamptz;
`,
  },
  {
    id: "0003_relay_passkeys",
    sql: `
create table if not exists passkey_credentials (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  device_id text not null references devices(id) on delete cascade,
  webauthn_user_id text not null,
  credential_id text not null unique,
  public_key text not null,
  counter integer not null,
  transports text[] not null default '{}',
  backed_up boolean not null default false,
  created_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists passkey_challenges (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  session_id text references user_sessions(id) on delete cascade,
  device_id text references devices(id) on delete cascade,
  purpose text not null,
  challenge text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists passkey_credentials_user_id_idx on passkey_credentials(user_id);
create index if not exists passkey_challenges_user_id_idx on passkey_challenges(user_id);
`,
  },
] as const;

export function assertRelayMigrationsAreMetadataOnly(): void {
  const forbidden = [
    "conversation",
    "conversations",
    "diff",
    "diffs",
    "file_contents",
    "messages",
    "prompts",
    "terminal_output",
    "workspace_files",
  ];
  const sql = relayPostgresMigrations.map((migration) => migration.sql.toLowerCase()).join("\n");
  for (const term of forbidden) {
    if (sql.includes(term)) {
      throw new Error(`relay migration contains forbidden content table/key "${term}"`);
    }
  }
}
