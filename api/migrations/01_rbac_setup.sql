-- 1. Add role column to profiles table
ALTER TABLE profiles 
ADD COLUMN role TEXT 
CHECK (role IN ('superadmin', 'admin', 'operator', 'user'))
DEFAULT 'user';

-- 2. Create a function to handle new user signup (if you rely on triggers)
-- Note: If you already have a trigger for new users, ensure it sets the default role.
-- Postgres DEFAULT 'user' handles simple inserts, but if your trigger explicitly inserts null or something, check it.

-- 3. (Optional) Update existing users to have 'user' role
UPDATE profiles SET role = 'user' WHERE role IS NULL;
