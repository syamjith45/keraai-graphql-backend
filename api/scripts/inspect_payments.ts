
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log("Fetching payment statuses...");
    
    // Check if we can get any payments
    const { data: payments, error } = await supabase
        .from('payments')
        .select('status')
        .limit(20);

    if (error) {
        console.error("Error fetching payments:", error);
    } else {
        if (payments.length === 0) {
            console.log("No payments found in database.");
        } else {
            const statuses = [...new Set(payments.map(p => p.status))];
            console.log("Found existing payment statuses:", statuses);
        }
    }
    
    // Also try to get one booking to see if that helps (unrelated but useful)
    // And try to guess the enum values by attempting a dummy RPC call if possible? No.
}

main();
