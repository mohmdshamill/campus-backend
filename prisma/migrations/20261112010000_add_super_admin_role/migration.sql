-- Super Admin (whole campus) is separate from Website Admin (website creator)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
