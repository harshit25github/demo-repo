-- See your current user
SELECT current_user;

-- Check your role memberships
SELECT r.rolname as role_name,
       r.rolsuper as is_superuser,
       r.rolinherit as can_inherit,
       r.rolcreaterole as can_create_role,
       r.rolcreatedb as can_create_db,
       r.rolcanlogin as can_login,
       r.rolreplication as can_replicate
FROM pg_roles r
WHERE r.rolname = current_user;

-- See what privileges you have
SELECT * FROM information_schema.role_table_grants 
WHERE grantee = current_user;

-- Check database ownership
SELECT datname, datdba::regrole as owner 
FROM pg_database 
WHERE datname = current_database();
