-- Test helpers. Lives in its own schema; never deployed (scripts/test-db.sh only).
create schema test;
grant usage on schema test to anon, authenticated, service_role;

create function test.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;

create function test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set role anon';
end $$;

create function test.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

create function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'ok  %', p_msg;
end $$;

-- runs p_sql and passes only if it fails with a message starting with p_expect
create function test.fails(p_sql text, p_expect text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_expect || '%' then raise notice 'ok  % (%)', p_msg, sqlerrm; return; end if;
    raise exception 'FAIL: % - expected "%", got "%"', p_msg, p_expect, sqlerrm;
  end;
  raise exception 'FAIL: % - expected error "%", but it succeeded', p_msg, p_expect;
end $$;

-- slot for a route, N days from today, at an IST hour
create function test.slot(p_slug text, p_days int, p_hour int) returns uuid language sql stable as $$
  select s.id from public.slots s join public.routes r on r.id = s.route_id
  where r.slug = p_slug
    and s.starts_at = ((current_date + p_days)::timestamp + make_interval(hours => p_hour)) at time zone 'Asia/Kolkata'
$$;

create function test.people(p_ages int[]) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('full_name', 'Test Person ' || i, 'age', a, 'health_ok', true, 'consent', true))
  from unnest(p_ages) with ordinality as t(a, i)
$$;

grant execute on all functions in schema test to anon, authenticated, service_role;
