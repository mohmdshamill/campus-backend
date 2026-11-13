-- Rename the SUPER_ADMIN role to WEBSITE_ADMIN (existing users keep the role)
ALTER TYPE "Role" RENAME VALUE 'SUPER_ADMIN' TO 'WEBSITE_ADMIN';
