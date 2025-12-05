import { SupabaseClient } from '@supabase/supabase-js';

// Enums used in Logic
export enum BookingStatus {
    ACTIVE = 'ACTIVE',
    COMPLETED = 'Completed',
    CANCELLED = 'Cancelled',
    PAID = 'PAID'
}

// Context Interface (Used by Resolvers)
export interface ContextValue {
    user?: {
        uid: string;
        role: string;
        email?: string;
    }
    supabase: SupabaseClient;
}

// Export your types here
export interface Context {
    // Add context properties
}
