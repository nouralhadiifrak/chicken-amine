-- Chicken Amine: online orders (demo of the staff order screen).
-- Applied to the Supabase project "chicken-amine-commandes" (region eu-west-3).
--
-- Who can do what:
--   * customers (the anon role, not signed in) may only ADD an order, with a secret token their phone keeps,
--     and READ the status of their own order by sending that token in the "x-order-token" header;
--   * staff (signed-in Supabase Auth users listed in public.staff) see, update and clear only the orders of
--     their own restaurant; Realtime delivers new orders to them live (it applies the same RLS).

-- ---------- Tables ----------

create table public.staff (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  location text not null check (location in ('sidi-moumen', 'bouchaib-doukkali'))
);

create table public.orders (
  id             uuid primary key,
  token          uuid not null,
  location       text not null check (location in ('sidi-moumen', 'bouchaib-doukkali')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  status         text not null default 'new'
                 check (status in ('new', 'accepted', 'refused', 'ready', 'on_the_way', 'done')),
  eta_minutes    int check (eta_minutes between 5 and 180),
  accepted_at    timestamptz,
  refuse_reason  text check (char_length(refuse_reason) <= 120),
  mode           text not null check (mode in ('pickup', 'delivery')),
  customer_name  text not null check (char_length(customer_name) between 1 and 60),
  customer_phone text not null check (char_length(customer_phone) between 6 and 20),
  address        text check (char_length(address) <= 200),
  lat            double precision check (lat between 33 and 34),
  lng            double precision check (lng between -8 and -7),
  distance_km    numeric(5, 2) check (distance_km between 0 and 50),
  notes          text check (char_length(notes) <= 300),
  -- the lines as the customer saw them: [{ name, qty, details: [..], total }]
  items          jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 60),
  subtotal       int not null check (subtotal between 0 and 20000),
  delivery_fee   int not null default 0 check (delivery_fee between 0 and 100),
  total          int not null check (total between 0 and 20000),
  lang           text not null default 'fr' check (lang in ('fr', 'ar')),
  -- every order of the demo is a test order; staff can clear them in one tap
  demo           boolean not null default true,
  check (mode = 'pickup' or (lat is not null and lng is not null))
);

create index orders_location_created_idx on public.orders (location, created_at desc);
create index orders_phone_created_idx on public.orders (customer_phone, created_at desc);

-- ---------- Row Level Security ----------

alter table public.staff enable row level security;
alter table public.orders enable row level security;

-- Nothing is reachable through the Data API unless granted below.
revoke all on table public.staff, public.orders from anon, authenticated;

-- Staff read their own row (to know which restaurant they serve).
grant select on table public.staff to authenticated;
create policy "staff read their own row" on public.staff
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Customers add an order: only these columns (status, demo and the timestamps keep their defaults).
grant insert (id, token, location, mode, customer_name, customer_phone, address, lat, lng, distance_km,
              notes, items, subtotal, delivery_fee, total, lang)
  on table public.orders to anon;
create policy "customers add an order" on public.orders
  for insert to anon
  with check (true);

-- Customers read the status of their own order, with its token in the "x-order-token" header.
grant select (id, location, status, eta_minutes, accepted_at, refuse_reason, created_at, updated_at)
  on table public.orders to anon;
create policy "customers read their own order" on public.orders
  for select to anon
  using (token::text = (select current_setting('request.headers', true)::json ->> 'x-order-token'));

-- Staff see, update and clear the orders of their restaurant.
grant select on table public.orders to authenticated;
grant update (status, eta_minutes, refuse_reason) on table public.orders to authenticated;
grant delete on table public.orders to authenticated;
create policy "staff see their restaurant's orders" on public.orders
  for select to authenticated
  using (location = (select s.location from public.staff s where s.user_id = (select auth.uid())));
create policy "staff update their restaurant's orders" on public.orders
  for update to authenticated
  using (location = (select s.location from public.staff s where s.user_id = (select auth.uid())))
  with check (location = (select s.location from public.staff s where s.user_id = (select auth.uid())));
create policy "staff clear their restaurant's test orders" on public.orders
  for delete to authenticated
  using (demo and location = (select s.location from public.staff s where s.user_id = (select auth.uid())));

-- ---------- Triggers (in a schema the Data API does not expose) ----------

create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- At most 5 orders from the same phone in 10 minutes. Runs as the table owner: the anon role cannot see
-- other orders, so it could not count them itself.
create or replace function private.orders_limit_per_phone()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if (select count(*) from public.orders o
      where o.customer_phone = new.customer_phone and o.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Trop de commandes depuis ce numéro, réessayez dans quelques minutes.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.orders_limit_per_phone() from public;

create trigger orders_limit_per_phone
  before insert on public.orders
  for each row execute function private.orders_limit_per_phone();

-- updated_at, and when the order is accepted (the customer's countdown starts there).
create or replace function private.orders_touch()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    new.accepted_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.orders_touch() from public;

create trigger orders_touch
  before update on public.orders
  for each row execute function private.orders_touch();

-- ---------- Realtime: new and changed orders reach the staff screen live ----------

alter publication supabase_realtime add table public.orders;

-- ---------- October 29: online ordering becomes official ----------
-- (applied as the migration "orders_official_owner_role")

-- The owner: one account that sees both restaurants (location left empty).
alter table public.staff add column role text not null default 'staff' check (role in ('staff', 'owner'));
alter table public.staff alter column location drop not null;
alter table public.staff add constraint staff_location_required check (role = 'owner' or location is not null);

drop policy "staff see their restaurant's orders" on public.orders;
drop policy "staff update their restaurant's orders" on public.orders;
drop policy "staff clear their restaurant's test orders" on public.orders;

create policy "staff see their restaurant's orders" on public.orders
  for select to authenticated
  using (exists (select 1 from public.staff s
                 where s.user_id = (select auth.uid()) and (s.role = 'owner' or s.location = orders.location)));
create policy "staff update their restaurant's orders" on public.orders
  for update to authenticated
  using (exists (select 1 from public.staff s
                 where s.user_id = (select auth.uid()) and (s.role = 'owner' or s.location = orders.location)))
  with check (exists (select 1 from public.staff s
                      where s.user_id = (select auth.uid()) and (s.role = 'owner' or s.location = orders.location)));
create policy "staff clear their restaurant's test orders" on public.orders
  for delete to authenticated
  using (demo and exists (select 1 from public.staff s
                          where s.user_id = (select auth.uid()) and (s.role = 'owner' or s.location = orders.location)));

-- Online ordering is now the real thing: new orders are real orders.
alter table public.orders alter column demo set default false;

-- The statistics read orders of a whole month by restaurant and status.
create index orders_location_status_created_idx on public.orders (location, status, created_at desc);

-- To make an account the owner (after creating it in Authentication → Users):
--   insert into public.staff (user_id, role) values ('<user id>', 'owner');

-- ---------- October 29 (evening): cancelling, push notifications ----------
-- (applied as the migration "orders_cancel_and_push"; the push keys are inserted in push_config by hand, never
-- committed: insert into public.push_config (vapid_public, vapid_private, vapid_subject, call_secret) values (…))
-- * orders: status 'cancelled', cancelled_by ('customer' | 'staff'), cancel_reason. The customer may cancel his own
--   order while it waits (policy "customers cancel their own waiting order", with his x-order-token); the staff may
--   cancel at any time with a reason. A finished order (done, refused, cancelled) cannot be changed any more.
-- * push_subscriptions: the staff phones that turned notifications on (each account manages its own).
-- * push_config, push_sent: the sender's keys and what was already sent (no access from the site).
-- * private.call_push(): calls the edge function supabase/functions/push (pg_net), at once for each new order
--   (trigger orders_push_new) and every 30 s while orders wait (pg_cron job "push-reminders"); the function rings
--   the restaurant's phones, then again about once a minute, for 10 minutes at most.

-- ---------- October 30: orders kept 2 years (as the privacy page /confidentialite/ says) ----------
-- (applied as the migration "orders_keep_two_years")
select cron.schedule('orders-keep-two-years', '17 3 * * *', $$
  delete from public.orders where created_at < now() - interval '2 years'
$$);
