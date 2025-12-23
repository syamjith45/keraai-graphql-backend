import { SupabaseClient } from '@supabase/supabase-js';

// Enums used in Logic
export enum BookingStatus {
    PENDING = 'pending',
    CONFIRMED = 'confirmed',
    ACTIVE = 'active',
    COMPLETED = 'completed',
    CANCELLED = 'cancelled'
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
