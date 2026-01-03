
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function main() {
    console.log("STARTING_BRUTE_TEST");
    const { data: payments } = await supabase
        .from('payments')
        .select('id')
        .eq('status', 'pending') // assuming pending exists
        .limit(1);

    if (!payments || payments.length === 0) {
        console.log("NO_PENDING_PAYMENTS");
        return;
    }

    const id = payments[0].id;
    const candidates = [
        'succeeded', 
        'confirmed', 
        'verified', 
        'SUCCESS', 
        'COMPLETED', 
        'PAID',
        'complete', // sometimes used
        'finish',
        'done'
    ];

    for (const status of candidates) {
        const { error } = await supabase
            .from('payments')
            .update({ status: status })
            .eq('id', id);

        if (!error) {
            console.log(`Examples: SUCCESS for '${status}'`);
            // revert
            await supabase.from('payments').update({ status: 'pending' }).eq('id', id);
            return;
        } else {
            console.log(`FAILED '${status}': ${error.message}`);
        }
    }

    console.log("ALL_FAILED");
}

main();
