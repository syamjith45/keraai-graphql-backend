require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
}

// Initialize Supabase Admin Client
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const getUserIdByEmail = async (email) => {
    // This is a naive way to find a user by email using listUsers. 
    // For production, you might want to use the UID directly.
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;

    const user = data.users.find(u => u.email === email);
    return user ? user.id : null;
};

const assignRole = async () => {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log("Usage: node assign_role.js <email_or_uid> <role>");
        console.log("Example: node assign_role.js user@example.com operator");
        process.exit(1);
    }

    let [identifier, role] = args;

    // Check if identifier looks like an email
    let uid = identifier;
    if (identifier.includes('@')) {
        console.log(`Looking up user by email: ${identifier}...`);
        const foundUid = await getUserIdByEmail(identifier);
        if (!foundUid) {
            console.error("Error: User not found with that email.");
            process.exit(1);
        }
        uid = foundUid;
    }

    console.log(`Assigning role '${role}' to user ${uid}...`);

    const { data, error } = await supabase.auth.admin.updateUserById(uid, {
        app_metadata: {
            role: role
        }
    });

    if (error) {
        console.error("Error updating user:", error.message);
    } else {
        console.log("Success! Updated user metadata:");
        console.log(JSON.stringify(data.user.app_metadata, null, 2));
    }
};

assignRole();
