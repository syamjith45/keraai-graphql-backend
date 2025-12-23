"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // MUST be service role key to bypass RLS if needed, or just admin access
if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
}
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
const main = async () => {
    const email = process.argv[2];
    if (!email) {
        console.error("Please provide an email address as an argument.");
        console.log("Usage: npx ts-node scripts/seed_superadmin.ts <email>");
        process.exit(1);
    }
    console.log(`Looking for user with email: ${email}...`);
    // We need to find the user ID from the email. 
    // Since we can't easily query auth.users directly without admin privileges, 
    // we assume the user exists in 'profiles' or we use listUsers if we have service key.
    // Attempt to update profile directly
    // First, find the user in profiles (assuming triggers created it)
    const { data: profiles, error: searchError } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .ilike('email', email) // Assuming you have email in profiles? If not, we might fail here.
        .single();
    // If email is NOT in profiles, we rely on auth.admin (if service role key has access)
    // But typically public profiles might not have email. 
    // Let's assume the user knows their ID or we try to find it via auth admin.
    let userId = profiles?.id;
    if (!userId) {
        console.log("User not found in 'profiles' by email (or email column missing). Trying Auth Admin API...");
        const { data, error } = await supabase.auth.admin.listUsers();
        if (error) {
            console.error("Error listing users:", error.message);
            process.exit(1);
        }
        const user = data.users.find(u => u.email === email);
        if (!user) {
            console.error("User not found in Auth system.");
            process.exit(1);
        }
        userId = user.id;
    }
    console.log(`Found User ID: ${userId}`);
    console.log(`Promoting to Superadmin...`);
    const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: 'superadmin' })
        .eq('id', userId);
    if (updateError) {
        console.error("Failed to update role:", updateError.message);
    }
    else {
        console.log(`Success! User ${email} (${userId}) is now a SUPERADMIN.`);
    }
};
main();
