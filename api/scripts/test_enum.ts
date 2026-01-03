
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function main() {
    process.stdout.write("STARTING_TEST\n");
    const { data: payments } = await supabase
        .from('payments')
        .select('id')
        .eq('status', 'pending')
        .limit(1);

    if (!payments || payments.length === 0) {
        console.log("NO_PENDING_PAYMENTS");
        return;
    }

    const id = payments[0].id;
    
    // Try 'completed'
    const { error: errorCompleted } = await supabase
        .from('payments')
        .update({ status: 'completed' })
        .eq('id', id);

    if (!errorCompleted) {
        console.log("RESULT: completed");
        await supabase.from('payments').update({ status: 'pending' }).eq('id', id);
        return;
    } 

    // Try 'paid'
    const { error: errorPaid } = await supabase
        .from('payments')
        .update({ status: 'paid' })
        .eq('id', id);
    
    if (!errorPaid) {
        console.log("RESULT: paid");
        await supabase.from('payments').update({ status: 'pending' }).eq('id', id);
        return;
    }

    console.log("RESULT: NONE_WORKED");
}

main();
