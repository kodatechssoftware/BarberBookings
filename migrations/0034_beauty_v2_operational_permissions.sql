-- Extend the code-owned capability registry for Beauty v2 operational access.
-- Preset contents remain runtime-owned and no existing scope or user is changed.

ALTER TABLE {{schema}}.user_access_scope_capabilities
  DROP CONSTRAINT user_access_scope_capabilities_code_check;

ALTER TABLE {{schema}}.user_access_scope_capabilities
  ADD CONSTRAINT user_access_scope_capabilities_code_check CHECK ((capability_code IN (
    'agenda.view_own',
    'agenda.view_team',
    'appointments.create_manual',
    'appointments.block_time',
    'appointments.block_time_own',
    'appointments.manage_own',
    'appointments.manage_team',
    'appointments.change_status_own',
    'appointments.change_status_team',
    'appointment_requests.view',
    'customers.view_own',
    'customers.view_team',
    'customers.notes_own',
    'customers.notes_team',
    'customers.block',
    'team.view',
    'team.manage_global',
    'team.assign_location',
    'catalog.view',
    'catalog.manage_global',
    'catalog.manage_location',
    'hours.manage_own',
    'hours.view_team',
    'hours.manage_team',
    'hours.manage_establishment',
    'extras.manage',
    'finance.view_own',
    'finance.view_team',
    'finance.manage_expenses',
    'finance.manage_compensation',
    'reports.export_own',
    'reports.export_team',
    'locations.manage',
    'users.manage',
    'access.manage',
    'settings.manage',
    'audit.view',
    'system.diagnostics'
  )) IS TRUE);
