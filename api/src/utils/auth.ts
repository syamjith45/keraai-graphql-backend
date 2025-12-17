import { User } from '../types';

export const requireRole = (user: User | undefined | null, allowedRoles: string[]) => {
    if (!user) {
        throw new Error("Authentication required");
    }

    if (!allowedRoles.includes(user.role)) {
        throw new Error("Permission denied");
    }
};
