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

-- ---------- October 30: saving a phone for notifications ----------
-- (applied as the migration "push_subscriptions_upsert") The app saves a phone with an "insert or update" that
-- rewrites every column it sends, endpoint included; without this the save was refused (403).
grant update (endpoint, p256dh, auth) on table public.push_subscriptions to authenticated;

-- ---------- October 30: notification diagnostics ----------
-- (applied as the migration "push_diagnostics")
alter table public.push_subscriptions add column device text check (char_length(device) <= 300);
grant update (device) on table public.push_subscriptions to authenticated;
-- push_log: every answer of the push services (status, detail), for diagnosis; a week is kept.
--   select at, kind, status, detail, device from public.push_log order by at desc limit 20;
create table public.push_log (
  id bigint generated always as identity primary key, at timestamptz not null default now(), user_id uuid,
  device text, endpoint text, status int, detail text, kind text not null default 'order'
);
alter table public.push_log enable row level security;
revoke all on table public.push_log from anon, authenticated;
select cron.schedule('push-log-week', '23 3 * * *', $$ delete from public.push_log where at < now() - interval '7 days' $$);

-- ---------- October 30: personal details erased after 24 hours (privacy page /confidentialite/) ----------
-- (applied as the migration "orders_forget_after_24h") Every 15 minutes, orders older than 24 hours lose the
-- customer's name, phone, address, map point, distance and note; dishes, amounts, date and restaurant stay for the
-- statistics (still deleted after 2 years by "orders-keep-two-years"). anonymized_at marks the emptied orders; the
-- site cannot write it, so a new order still needs a name and a phone.
alter table public.orders add column anonymized_at timestamptz;
alter table public.orders alter column customer_name drop not null, alter column customer_phone drop not null;
alter table public.orders add constraint orders_customer_given check ((customer_name is not null and customer_phone is not null) or anonymized_at is not null);
alter table public.orders drop constraint orders_check;
alter table public.orders add constraint orders_check check (mode = 'pickup' or (lat is not null and lng is not null) or anonymized_at is not null);
-- private.orders_touch(): lets the clean-up empty a finished order, without changing updated_at:
--   if new.anonymized_at is not null and old.anonymized_at is null and current_user not in ('anon', 'authenticated') then
--     return new;
--   end if;
create or replace function private.orders_forget()
 returns void language sql set search_path to '' as $function$
  update public.orders
     set customer_name = null, customer_phone = null, address = null, lat = null, lng = null,
         distance_km = null, notes = null, anonymized_at = now()
   where anonymized_at is null and created_at < now() - interval '24 hours';
$function$;
revoke all on function private.orders_forget() from public, anon, authenticated;
select cron.schedule('orders-forget-24h', '*/15 * * * *', 'select private.orders_forget()');

-- ---------- November 3: the statistics are the owner's only ----------
-- (migration "orders_staff_last_24h")
-- A restaurant account only needs the orders of the last 24 hours (that is all its screen shows). Older
-- orders, and so the statistics, stay readable by the owner only, also through the API.
drop policy "staff see their restaurant's orders" on public.orders;
drop policy "staff update their restaurant's orders" on public.orders;
drop policy "staff clear their restaurant's test orders" on public.orders;

create policy "staff see their restaurant's orders" on public.orders
  for select to authenticated
  using (exists (select 1 from public.staff s
                 where s.user_id = (select auth.uid())
                   and (s.role = 'owner' or (s.location = orders.location and orders.created_at > now() - interval '24 hours'))));
create policy "staff update their restaurant's orders" on public.orders
  for update to authenticated
  using (exists (select 1 from public.staff s
                 where s.user_id = (select auth.uid())
                   and (s.role = 'owner' or (s.location = orders.location and orders.created_at > now() - interval '24 hours'))))
  with check (exists (select 1 from public.staff s
                      where s.user_id = (select auth.uid()) and (s.role = 'owner' or s.location = orders.location)));
create policy "staff clear their restaurant's test orders" on public.orders
  for delete to authenticated
  using (demo and exists (select 1 from public.staff s
                          where s.user_id = (select auth.uid())
                            and (s.role = 'owner' or (s.location = orders.location and orders.created_at > now() - interval '24 hours'))));
-- ---------- November 9: promotions chosen by the owner ----------
-- (migration "promotions") The owner's account creates them in the staff app (« Promotions »): which restaurant
-- (or both), which dishes (the whole menu, categories or single dishes), a percentage or an amount in DH, a start and
-- an end, and optionally the same hours every day. The site shows them and sends each discounted line with its
-- promotion; the database checks it (orders_check_promos). Rules shared with js/promos.js: the discount is rounded
-- to the dirham, the biggest promotion wins, delivery is never discounted, and an order is still accepted 10 minutes
-- after a promotion ends (the customer may have filled the cart just before).
create table public.promotions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 80),
  location     text check (location in ('sidi-moumen', 'bouchaib-doukkali')),  -- null: both restaurants
  all_items    boolean not null default false,
  category_ids text[] not null default '{}',
  item_ids     text[] not null default '{}',
  kind         text not null check (kind in ('percent', 'amount')),
  value        int not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  daily_from   time,  -- Casablanca time; both or neither
  daily_to     time,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((kind = 'percent' and value between 1 and 90) or (kind = 'amount' and value between 1 and 500)),
  check (ends_at > starts_at),
  check ((daily_from is null) = (daily_to is null) and (daily_from is null or daily_from <> daily_to)),
  check (all_items or cardinality(category_ids) + cardinality(item_ids) > 0),
  check (cardinality(category_ids) <= 50 and cardinality(item_ids) <= 400)
);
create index promotions_ends_idx on public.promotions (ends_at);
alter table public.promotions enable row level security;
revoke all on table public.promotions from anon, authenticated;

-- Everyone (the site) reads the promotions that are on or just ended, without the owner's name for them.
grant select (id, location, all_items, category_ids, item_ids, kind, value, starts_at, ends_at, daily_from, daily_to, active)
  on table public.promotions to anon;
grant select on table public.promotions to authenticated;
create policy "everyone sees the current promotions" on public.promotions
  for select to anon, authenticated
  using (active and ends_at > now() - interval '10 minutes');
-- Only the owner's account sees all of them and creates, changes or deletes them.
grant insert (name, location, all_items, category_ids, item_ids, kind, value, starts_at, ends_at, daily_from, daily_to, active),
      update (name, location, all_items, category_ids, item_ids, kind, value, starts_at, ends_at, daily_from, daily_to, active),
      delete
  on table public.promotions to authenticated;
create policy "the owner sees every promotion" on public.promotions
  for select to authenticated
  using (exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'owner'));
create policy "the owner adds promotions" on public.promotions
  for insert to authenticated
  with check (exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'owner'));
create policy "the owner changes promotions" on public.promotions
  for update to authenticated
  using (exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'owner'))
  with check (exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'owner'));
create policy "the owner deletes promotions" on public.promotions
  for delete to authenticated
  using (exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'owner'));

create or replace function private.promotions_touch()
 returns trigger language plpgsql set search_path to '' as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;
revoke all on function private.promotions_touch() from public, anon, authenticated;
create trigger promotions_touch before update on public.promotions
  for each row execute function private.promotions_touch();

-- The daily hours of a promotion, in Casablanca time (they may run past midnight: 22:00 – 02:00).
create or replace function private.promo_in_window(f time, t time, at timestamptz)
 returns boolean language sql stable set search_path to '' as $function$
  select f is null or t is null
      or case when f < t then x >= f and x < t else x >= f or x < t end
    from (select (at at time zone 'Africa/Casablanca')::time as x) s;
$function$;
revoke all on function private.promo_in_window(time, time, timestamptz) from public, anon, authenticated;

-- Each order: a discounted line must name a promotion that is on (for this restaurant, this dish, now, give or
-- take 10 minutes) and take exactly its discount off; and the totals must add up.
create or replace function private.orders_check_promos()
 returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  l jsonb;
  p public.promotions;
  unit int; qty int; off int; want int; sub int := 0;
  t timestamptz := now();
begin
  for l in select * from jsonb_array_elements(new.items) loop
    qty := coalesce((l->>'qty')::int, 0);
    sub := sub + coalesce((l->>'total')::int, 0);
    if l ? 'promo' then
      select * into p from public.promotions where id = (l->>'promo')::uuid;
      if not found or not p.active or t < p.starts_at or t >= p.ends_at + interval '10 minutes'
         or (p.location is not null and p.location <> new.location)
         or not (p.all_items or (l->>'id') = any (p.item_ids) or (l->>'cat') = any (p.category_ids))
         or not (private.promo_in_window(p.daily_from, p.daily_to, t)
                 or private.promo_in_window(p.daily_from, p.daily_to, t - interval '10 minutes')) then
        raise exception 'Promotion terminée ou invalide';
      end if;
      unit := (l->>'unit')::int;
      off := (l->>'off')::int;
      want := least(unit, case when p.kind = 'percent' then round(unit * p.value / 100.0)::int else p.value end);
      if unit is null or unit < 0 or off is distinct from want or (l->>'total')::int is distinct from (unit - off) * qty then
        raise exception 'Promotion : montant incorrect';
      end if;
    elsif coalesce((l->>'off')::int, 0) <> 0 then
      raise exception 'Promotion invalide';
    end if;
  end loop;
  if new.subtotal <> sub or new.total <> new.subtotal + new.delivery_fee then
    raise exception 'Commande invalide : total incorrect';
  end if;
  return new;
end
$function$;
revoke all on function private.orders_check_promos() from public, anon, authenticated;
create trigger orders_check_promos before insert on public.orders
  for each row execute function private.orders_check_promos();
