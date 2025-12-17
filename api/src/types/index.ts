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
    user?: User;
    supabase: SupabaseClient;
}

export interface User {
    uid: string;
    role: 'superadmin' | 'admin' | 'operator' | 'user';
    email?: string;
}

// Export your types here
export interface Context {
    // Add context properties
}
