-- ============================================================================
-- Referenz-Editor - Supabase Setup
-- ----------------------------------------------------------------------------
-- Wiederholbares Skript, Einmalig im Supabase-Dashboard unter  SQL Editor  ->
-- New query  ausfuehren (oder mehrmals, alle Schritte sind idempotent).
-- Setzt voraus, dass im selben Projekt bereits das Setup der
-- Blockschaltbild-App ausgefuehrt wurde (Tabellen public.profiles,
-- public.projects sowie die Funktionen public.is_admin(),
-- public.is_active() und public.touch_updated_at() existieren dort).
-- Gemeinsame Referenzliste: Jeder AKTIVE Nutzer sieht und bearbeitet alle
-- nicht geloeschten Referenzen. "Loeschen" ist ein Soft-Delete (deleted_at),
-- ein echtes DELETE ist nur Admins erlaubt.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Referenzprojekte: die gespeicherten Referenzblaetter (JSON inkl. Bilder)
--    created_by bleibt absichtlich NULL-faehig: wird der Auth-Nutzer
--    geloescht (on delete set null), bleibt das Referenzblatt erhalten.
-- ---------------------------------------------------------------------------
create table if not exists public.reference_projects (
    id               uuid primary key default gen_random_uuid(),
    created_by       uuid references auth.users(id) on delete set null default auth.uid(),
    created_by_email text default (auth.jwt() ->> 'email'),
    updated_by_email text,
    nr               text,
    kunde            text,
    veranstaltung    text,
    art              text,
    title            text,                              -- Anzeigename des Blattes
    data             jsonb not null,                    -- komplettes Editor-Datenobjekt (Bilder als Data-URLs)
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    deleted_at       timestamptz                        -- Soft-Delete ("Papierkorb")
);

create index if not exists idx_reference_updated_at on public.reference_projects(updated_at);
create index if not exists idx_reference_deleted_at on public.reference_projects(deleted_at);
alter table public.reference_projects enable row level security;

-- ---------------------------------------------------------------------------
-- 2) RLS-Policies fuer reference_projects
--    - Jeder AKTIVE Nutzer darf ALLE nicht geloeschten Referenzen lesen,
--      eigene anlegen und alle nicht geloeschten bearbeiten (gemeinsame Liste).
--    - "Loeschen" durch einen Ersteller oder Admin setzt nur deleted_at
--      (Soft-Delete); der Trigger reference_protect() prueft die Berechtigung.
--    - Ein echtes DELETE ist nur Admins erlaubt (es gibt keine
--      Loesch-Policy fuer normale Nutzer -> umkehrbar).
--    - Admins sehen auch geloeschte Referenzen und duerfen alles aendern.
-- ---------------------------------------------------------------------------
drop policy if exists reference_select_active on public.reference_projects;
drop policy if exists reference_insert_active on public.reference_projects;
drop policy if exists reference_update_active on public.reference_projects;
drop policy if exists reference_select_admin   on public.reference_projects;
drop policy if exists reference_insert_admin   on public.reference_projects;
drop policy if exists reference_update_admin   on public.reference_projects;
drop policy if exists reference_delete_admin   on public.reference_projects;

create or replace function public.is_ict_user()
returns boolean language sql stable as $$
    select lower(coalesce(auth.jwt() ->> 'email', '')) like '%@ict.de';
$$;

create policy reference_select_active on public.reference_projects
    for select using (public.is_ict_user() and public.is_active() and deleted_at is null);
create policy reference_insert_active on public.reference_projects
    for insert with check (public.is_ict_user() and public.is_active() and created_by = auth.uid());
create policy reference_update_active on public.reference_projects
    for update using (public.is_ict_user() and public.is_active() and deleted_at is null and created_by = auth.uid())
              with check (public.is_ict_user() and public.is_active() and created_by = auth.uid());

create policy reference_select_admin on public.reference_projects for select using (public.is_admin());
create policy reference_insert_admin on public.reference_projects for insert with check (public.is_admin());
create policy reference_update_admin on public.reference_projects for update using (public.is_admin()) with check (public.is_admin());
create policy reference_delete_admin on public.reference_projects for delete using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2b) Schutz-Trigger vor jedem UPDATE:
--     - created_by darf nie geaendert werden (nur Admins duerfen das).
--     - deleted_at darf nur vom Ersteller oder von Admins gesetzt werden.
--     - updated_by_email wird aus dem JWT des Aufrufers gesetzt.
-- ---------------------------------------------------------------------------
create or replace function public.reference_protect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.created_by is distinct from old.created_by and not public.is_admin() then
        raise exception 'Der Ersteller einer Referenz kann nicht geaendert werden.';
    end if;
    if new.deleted_at is distinct from old.deleted_at
       and not (public.is_admin() or old.created_by = auth.uid()) then
        raise exception 'Nur der Ersteller oder ein Admin darf eine Referenz loeschen.';
    end if;
    new.updated_by_email = auth.jwt() ->> 'email';
    return new;
end;
$$;

drop trigger if exists trg_reference_protect on public.reference_projects;
create trigger trg_reference_protect
    before update on public.reference_projects
    for each row execute function public.reference_protect();

-- updated_at automatisch aktuell halten (vorhandene Hilfsfunktion verwenden)
drop trigger if exists trg_reference_touch on public.reference_projects;
create trigger trg_reference_touch
    before update on public.reference_projects
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Sicherungen: vor jedem Ueberschreiben (data aendert sich) und beim
--    Setzen von deleted_at wird der alte Stand automatisch gesichert
--    (Trigger, SECURITY DEFINER). Nur Admins koennen Sicherungen lesen und
--    loeschen. project_id hat absichtlich KEINEN Fremdschluessel, damit
--    Sicherungen auch nach endgueltigem Loeschen des Projekts erhalten bleiben.
--    Pro Projekt bleiben die letzten 30 Sicherungen erhalten.
-- ---------------------------------------------------------------------------
create table if not exists public.reference_project_backups (
    id         uuid primary key default gen_random_uuid(),
    project_id uuid not null,
    user_id    uuid not null references auth.users(id) on delete cascade,
    data       jsonb not null,
    title      text,
    reason     text not null check (reason in ('update', 'delete')),
    created_at timestamptz not null default now()
);

create index if not exists idx_reference_backups_project on public.reference_project_backups(project_id, created_at desc);
create index if not exists idx_reference_backups_user    on public.reference_project_backups(user_id);
alter table public.reference_project_backups enable row level security;

drop policy if exists reference_backups_select_admin on public.reference_project_backups;
drop policy if exists reference_backups_delete_admin on public.reference_project_backups;
create policy reference_backups_select_admin on public.reference_project_backups for select using (public.is_admin());
create policy reference_backups_delete_admin on public.reference_project_backups for delete using (public.is_admin());

create or replace function public.backup_reference_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_reason text;
begin
    if new.deleted_at is not null and old.deleted_at is null then
        v_reason := 'delete';
    elsif new.data is distinct from old.data then
        v_reason := 'update';
    else
        return new;   -- z. B. nur Umbenennung / Wiederherstellung -> keine Sicherung noetig
    end if;

    insert into public.reference_project_backups (project_id, user_id, data, title, reason)
    values (old.id, coalesce(auth.uid(), old.created_by), old.data, old.title, v_reason);

    delete from public.reference_project_backups
     where project_id = old.id
       and id not in (
           select id from public.reference_project_backups
            where project_id = old.id
            order by created_at desc
            limit 30
       );

    return new;
end;
$$;

drop trigger if exists trg_reference_backup on public.reference_projects;
create trigger trg_reference_backup
    before update on public.reference_projects
    for each row execute function public.backup_reference_project();

-- ---------------------------------------------------------------------------
-- 4) Listenfunktion: schnelle Uebersicht OHNE die grosse data-Spalte.
--    security invoker -> die RLS-Policies des Aufrufers gelten automatisch
--    (aktive Nutzer sehen nur nicht geloeschte, Admins auch geloeschte).
--    owner = true, wenn der Aufrufer der Ersteller der Referenz ist.
-- ---------------------------------------------------------------------------
create or replace function public.list_reference_projects()
returns table (
    id               uuid,
    nr               text,
    kunde            text,
    veranstaltung    text,
    art              text,
    title            text,
    created_by_email text,
    updated_by_email text,
    created_at       timestamptz,
    updated_at       timestamptz,
    owner            boolean
)
language sql stable set search_path = public as $$
    select r.id, r.nr, r.kunde, r.veranstaltung, r.art, r.title,
           r.created_by_email, r.updated_by_email, r.created_at, r.updated_at,
           r.created_by = auth.uid() as owner
      from public.reference_projects r
     order by r.updated_at desc;
$$;

-- Realtime ist nicht noetig (kein supabase_realtime publication Eintrag).

-- ---------------------------------------------------------------------------
-- 5) Verifizierung im SQL Editor (Hinweise)
--    -- Uebersicht aller fuer den aktuellen Nutzer sichtbaren Referenzen:
--    select * from public.list_reference_projects();
--
--    -- Einzelne Referenz samt data laden:
--    select * from public.reference_projects where id = '<REFERENZ-ID>';
--
--    -- Anzahl Sicherungen je Referenz (nur Admins sichtbar):
--    select project_id, count(*) as sicherungen
--      from public.reference_project_backups
--     group by project_id;
--
--    -- Sicherungen einer Referenz ansehen (nur Admins):
--    select reason, title, created_at from public.reference_project_backups
--     where project_id = '<REFERENZ-ID>'
--     order by created_at desc;
--
--    -- Soft-Delete durch Ersteller (und nur durch Ersteller/Admin):
--    update public.reference_projects
--       set deleted_at = now()
--     where id = '<REFERENZ-ID>';
--
--    -- Endgueltig loeschen (nur Admins):
--    delete from public.reference_projects where id = '<REFERENZ-ID>';
-- ---------------------------------------------------------------------------
