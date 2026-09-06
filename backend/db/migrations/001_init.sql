-- 001_init.sql — Radnas initial schema
-- Note: gen_random_uuid() is built into PostgreSQL 13+ core (no pgcrypto needed).

-- ===== Managers (owner / admins / resellers) — hierarchical tree =====
CREATE TABLE managers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     uuid REFERENCES managers(id) ON DELETE SET NULL,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name     text,
  phone         text,
  email         text,
  role          text NOT NULL DEFAULT 'reseller' CHECK (role IN ('owner','admin','reseller')),
  balance       numeric(14,2) NOT NULL DEFAULT 0,
  points        integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','pending','rejected')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_managers_parent ON managers(parent_id);

-- ===== Plans (packages) =====
CREATE TABLE plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  type                text NOT NULL DEFAULT 'pppoe' CHECK (type IN ('pppoe','hotspot')),
  price               numeric(14,2) NOT NULL DEFAULT 0,
  daily_reset_price   numeric(14,2) NOT NULL DEFAULT 0,
  download_mbps       integer NOT NULL DEFAULT 0,
  upload_mbps         integer NOT NULL DEFAULT 0,
  duration_value      integer NOT NULL DEFAULT 30,
  duration_unit       text NOT NULL DEFAULT 'days' CHECK (duration_unit IN ('hours','days','months')),
  daily_quota_mb      bigint,   -- NULL = unlimited
  monthly_quota_mb    bigint,   -- NULL = unlimited
  mikrotik_pool       text,
  expired_pool        text,
  fup_down_kbps       integer,
  fup_up_kbps         integer,
  fup_behavior        text NOT NULL DEFAULT 'throttle' CHECK (fup_behavior IN ('throttle','disconnect','block')),
  free_hours_from     time,
  free_hours_to       time,
  burst_from          time,
  burst_to            time,
  allow_burst_monthly boolean NOT NULL DEFAULT false,
  description         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ===== Subscribers =====
CREATE TABLE subscribers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username        text UNIQUE NOT NULL,
  password        text NOT NULL,
  full_name       text,
  phone           text,
  address         text,
  plan_id         uuid REFERENCES plans(id) ON DELETE SET NULL,
  manager_id      uuid REFERENCES managers(id) ON DELETE SET NULL,
  connection_type text NOT NULL DEFAULT 'pppoe' CHECK (connection_type IN ('pppoe','hotspot')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','expired')),
  mac             text,
  mac_locked      boolean NOT NULL DEFAULT false,
  static_ip       text,
  expiry_at       timestamptz,
  paid_date       date,
  is_paid         boolean NOT NULL DEFAULT false,
  last_online_at  timestamptz,
  daily_used_mb   bigint NOT NULL DEFAULT 0,
  monthly_used_mb bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscribers_manager ON subscribers(manager_id);
CREATE INDEX idx_subscribers_plan    ON subscribers(plan_id);
CREATE INDEX idx_subscribers_status  ON subscribers(status);
CREATE INDEX idx_subscribers_expiry  ON subscribers(expiry_at);

-- ===== NAS / routers (FreeRADIUS-compatible) =====
CREATE TABLE nas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nasname      text NOT NULL,          -- IP or hostname
  shortname    text,
  type         text NOT NULL DEFAULT 'other',
  ports        integer,
  secret       text NOT NULL,
  server       text,
  community    text,
  description  text,
  api_enabled  boolean NOT NULL DEFAULT false,
  api_port     integer,
  api_user     text,
  api_password text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ===== FreeRADIUS core tables =====
CREATE TABLE radcheck (
  id        bigserial PRIMARY KEY,
  username  text NOT NULL DEFAULT '',
  attribute text NOT NULL DEFAULT '',
  op        varchar(2) NOT NULL DEFAULT '==',
  value     text NOT NULL DEFAULT ''
);
CREATE INDEX idx_radcheck_username ON radcheck(username);

CREATE TABLE radreply (
  id        bigserial PRIMARY KEY,
  username  text NOT NULL DEFAULT '',
  attribute text NOT NULL DEFAULT '',
  op        varchar(2) NOT NULL DEFAULT '=',
  value     text NOT NULL DEFAULT ''
);
CREATE INDEX idx_radreply_username ON radreply(username);

CREATE TABLE radusergroup (
  id        bigserial PRIMARY KEY,
  username  text NOT NULL DEFAULT '',
  groupname text NOT NULL DEFAULT '',
  priority  integer NOT NULL DEFAULT 1
);
CREATE INDEX idx_radusergroup_username ON radusergroup(username);

CREATE TABLE radgroupcheck (
  id        bigserial PRIMARY KEY,
  groupname text NOT NULL DEFAULT '',
  attribute text NOT NULL DEFAULT '',
  op        varchar(2) NOT NULL DEFAULT '==',
  value     text NOT NULL DEFAULT ''
);
CREATE INDEX idx_radgroupcheck_groupname ON radgroupcheck(groupname);

CREATE TABLE radgroupreply (
  id        bigserial PRIMARY KEY,
  groupname text NOT NULL DEFAULT '',
  attribute text NOT NULL DEFAULT '',
  op        varchar(2) NOT NULL DEFAULT '=',
  value     text NOT NULL DEFAULT ''
);
CREATE INDEX idx_radgroupreply_groupname ON radgroupreply(groupname);

CREATE TABLE radacct (
  radacctid          bigserial PRIMARY KEY,
  acctsessionid      text NOT NULL DEFAULT '',
  acctuniqueid       text NOT NULL DEFAULT '',
  username           text NOT NULL DEFAULT '',
  realm              text,
  nasipaddress       inet,
  nasportid          text,
  nasporttype        text,
  acctstarttime      timestamptz,
  acctupdatetime     timestamptz,
  acctstoptime       timestamptz,
  acctinterval       bigint,
  acctsessiontime    bigint,
  acctauthentic      text,
  connectinfo_start  text,
  connectinfo_stop   text,
  acctinputoctets    bigint,
  acctoutputoctets   bigint,
  calledstationid    text,
  callingstationid   text,
  acctterminatecause text,
  servicetype        text,
  framedprotocol     text,
  framedipaddress    inet,
  -- IPv6 columns required by FreeRADIUS 3.2.x default postgresql accounting query
  framedipv6address   inet,
  framedipv6prefix    inet,
  framedinterfaceid   text,
  delegatedipv6prefix inet
);
CREATE INDEX idx_radacct_username     ON radacct(username);
-- UNIQUE: FreeRADIUS accounting uses "ON CONFLICT (AcctUniqueId)" which requires a unique index
CREATE UNIQUE INDEX idx_radacct_acctuniqueid ON radacct(acctuniqueid);
CREATE INDEX idx_radacct_active       ON radacct(acctstoptime) WHERE acctstoptime IS NULL;

-- FreeRADIUS post-auth log (required — its post-auth query INSERTs here on every auth)
CREATE TABLE radpostauth (
  id               bigserial PRIMARY KEY,
  username         text NOT NULL DEFAULT '',
  pass             text,
  reply            text,
  calledstationid  text,
  callingstationid text,
  authdate         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_radpostauth_username ON radpostauth(username);

-- ===== Invoices =====
CREATE TABLE invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text UNIQUE NOT NULL,
  subscriber_id uuid REFERENCES subscribers(id) ON DELETE SET NULL,
  manager_id    uuid REFERENCES managers(id) ON DELETE SET NULL,
  description   text,
  amount        numeric(14,2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'IQD',
  status        text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid','unpaid')),
  issued_at     date NOT NULL DEFAULT current_date,
  paid_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_manager ON invoices(manager_id);
CREATE INDEX idx_invoices_status  ON invoices(status);

-- ===== Financial transactions (ledger) =====
CREATE TABLE transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id      uuid REFERENCES managers(id) ON DELETE SET NULL,
  counterparty_id uuid REFERENCES managers(id) ON DELETE SET NULL,
  type            text NOT NULL CHECK (type IN ('charge','commission','topup','withdraw','transfer')),
  direction       text NOT NULL DEFAULT 'out' CHECK (direction IN ('in','out')),
  amount          numeric(14,2) NOT NULL DEFAULT 0,
  points          integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'paid',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_transactions_manager ON transactions(manager_id);

-- ===== Hotspot (batches + cards/vouchers) =====
CREATE TABLE hotspot_batches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text UNIQUE NOT NULL,
  plan_id    uuid REFERENCES plans(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES managers(id) ON DELETE SET NULL,
  count      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hotspot_cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid REFERENCES hotspot_batches(id) ON DELETE CASCADE,
  username     text UNIQUE NOT NULL,
  password     text NOT NULL,
  plan_id      uuid REFERENCES plans(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','active','expired')),
  activated_at timestamptz,
  expiry_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hotspot_cards_batch ON hotspot_cards(batch_id);

-- ===== WireGuard peers (per-router tunnels) =====
CREATE TABLE wireguard_peers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  type           text NOT NULL DEFAULT 'mikrotik',
  public_key     text NOT NULL,
  tunnel_ip      inet,
  allowed_ips    text,
  nas_id         uuid REFERENCES nas(id) ON DELETE SET NULL,
  last_handshake timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ===== Audit log =====
CREATE TABLE audit_log (
  id                bigserial PRIMARY KEY,
  performed_by      uuid REFERENCES managers(id) ON DELETE SET NULL,
  performed_by_name text,
  action            text NOT NULL,
  target_type       text,
  target_id         text,
  details           text,
  ip                inet,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ===== Settings (key/value) =====
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
