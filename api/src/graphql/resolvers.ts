import { ContextValue, BookingStatus } from "../types";
import { requireRole } from "../utils/auth";

export const resolvers = {
    Query: {
        me: async (_: any, __: any, { user, supabase }: ContextValue) => {
            console.log("[(DEBUG) Resolver] 'me' query hit. User context:", user);
            if (!user) throw new Error("Unauthorized");
            const { data, error } = await supabase.from('profiles').select('*').eq('id', user.uid).single();
            if (error || !data) return null;
            return {
                uid: user.uid,
                email: user.email,
                name: data.full_name,
                role: user.role
            };
        },

        parkingLots: async (_: any, __: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            const { data } = await supabase.from('parking_lots').select('*');
            return data?.map((lot: any) => {
                const slotsArray = lot.slots
                    ? Object.entries(lot.slots).map(([id, status]) => ({ id, status: status as string }))
                    : [];
                return {
                    id: lot.id,
                    name: lot.name,
                    address: lot.address,
                    totalSlots: lot.total_spots,
                    availableSlots: lot.available_spots,
                    pricePerHour: lot.hourly_rate,
                    coords: { lat: lot.latitude, lng: lot.longitude },
                    slots: slotsArray
                };
            }) || [];
        },

        myBookings: async (_: any, __: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            const { data } = await supabase
                .from('bookings')
                .select(`*, parking_lots(name, address)`)
                .eq('user_id', user.uid)
                .order('start_time', { ascending: false });

            return data?.map((b: any) => ({
                id: b.id,
                userId: b.user_id,
                lotId: b.lot_id,
                parkingLotInfo: { name: (b.parking_lots as any)?.name, address: (b.parking_lots as any)?.address },
                slotNumber: b.qr_code_data?.split('_')[1] || "N/A",
                startTime: b.start_time,
                endTime: b.end_time,
                durationHours: 0,
                totalAmount: b.total_cost,
                status: b.status.toUpperCase()
            })) || [];
        },

        // ... Add allUsers and adminStats here following the same pattern
        allUsers: async (_: any, __: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['admin', 'superadmin']);
            const { data } = await supabase.from('profiles').select('*');
            return data?.map((u: any) => ({
                uid: u.id,
                name: u.full_name,
                email: u.email, // Note: Email might not be in profiles depending on schema, assume it is for now or join
                role: u.role,
                vehicle_make: u.vehicle_make,
                vehicle_plate: u.vehicle_plate
            })) || [];
        },

        adminStats: async (_: any, __: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['admin', 'superadmin']);
            // Fetch stats implementation...
            return {
                totalUsers: 0,
                totalLots: 0,
                activeBookings: 0,
                completedBookings: 0
            };
        }
    },

    Mutation: {
        setupProfile: async (_: any, { name, vehicle }: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            const updates = {
                full_name: name,
                vehicle_plate: vehicle.registrationNumber,
                vehicle_make: vehicle.type,
                updated_at: new Date().toISOString(),
            };
            const { data, error } = await supabase.from('profiles').update(updates).eq('id', user.uid).select().single();
            if (error) throw new Error(error.message);
            return { uid: user.uid, name: data.full_name, email: user.email, role: user.role };
        },

        createBooking: async (_: any, { lotId, slot, duration }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            if (!user) throw new Error("Unauthorized");

            const { data: lot, error: lotError } = await supabase.from('parking_lots').select('*').eq('id', lotId).single();
            if (lotError || !lot) throw new Error("Parking lot not found.");

            const currentSlots = lot.slots as Record<string, string>;
            if (currentSlots[slot] !== 'available') throw new Error("Slot occupied.");

            currentSlots[slot] = 'occupied';

            await supabase.from('parking_lots').update({
                slots: currentSlots,
                available_spots: lot.available_spots - 1
            }).eq('id', lotId);

            const startTime = new Date();
            const endTime = new Date(startTime.getTime() + duration * 3600 * 1000);

            const { data: booking, error } = await supabase.from('bookings').insert({
                user_id: user.uid,
                lot_id: lotId,
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                total_cost: lot.hourly_rate * duration,
                status: 'pending',
                qr_code_data: `${lot.id}_${slot}`
            }).select('*, parking_lots(name, address)').single();

            if (error) throw new Error(error.message);

            return {
                id: booking.id,
                userId: booking.user_id,
                lotId: booking.lot_id,
                parkingLotInfo: { name: booking.parking_lots.name, address: booking.parking_lots.address },
                slotNumber: slot,
                startTime: booking.start_time,
                endTime: booking.end_time,
                durationHours: duration,
                totalAmount: booking.total_cost,
                status: 'ACTIVE'
            };
        },

        // Role Management
        assignRole: async (_: any, { userId, role }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['superadmin']); // Only Superadmin can assign roles

            // Optional: Limit what roles can be assigned? e.g. superadmin can assign anything.
            const { data, error } = await supabase
                .from('profiles')
                .update({ role })
                .eq('id', userId)
                .select()
                .single();

            if (error) throw new Error(error.message);
            return {
                uid: data.id,
                name: data.full_name,
                email: data.email,
                role: data.role
            };
        },

        createAdmin: async (_: any, { email, name }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['superadmin']);
            // This assumes Supabase Auth user creation via Admin API if you have the key, 
            // OR you just create a profile record and wait for user to sign up. 
            // For strict correctness, we'd need to use supabase.auth.admin.createUser 
            // but that requires service_role key to be in the context or accessible.
            // Here we will just throw unsupported for now or assume simple profile creation.
            throw new Error("Create Admin requires separate Auth implementation.");
        },

        addParkingLot: async (_: any, args: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['admin', 'superadmin']);
            const { data, error } = await supabase.from('parking_lots').insert({
                name: args.name,
                address: args.address,
                total_spots: args.totalSlots,
                available_spots: args.totalSlots,
                hourly_rate: args.pricePerHour,
                latitude: args.lat,
                longitude: args.lng,
                // slotPrefix not in DB schema shown in previous turns, assuming logic handles it or ignored for now
            }).select().single();

            if (error) throw new Error(error.message);
            // Must return ParkingLot structure
            return {
                id: data.id,
                name: data.name,
                address: data.address,
                totalSlots: data.total_spots,
                availableSlots: data.available_spots,
                pricePerHour: data.hourly_rate,
                coords: { lat: data.latitude, lng: data.longitude },
                slots: []
            };
        },

        verifyBooking: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['operator', 'admin', 'superadmin']);
            // Logic validation...
            return {
                success: true,
                message: "Verified",
                details: "Valid"
            };
        },

        // Payment Mock Mutations
        createPaymentOrder: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            return {
                orderId: "ord_" + Math.random().toString(36).substr(2, 9),
                amount: 10.0, // mock
                currency: "INR",
                bookingId: bookingId,
                status: "CREATED"
            };
        },

        payOrder: async (_: any, { orderId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            return {
                success: true,
                message: "Payment Successful",
                paymentId: "pay_" + Math.random().toString(36).substr(2, 9),
                orderId: orderId
            };
        },

        verifyPayment: async (_: any, { orderId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            return {
                success: true,
                message: "Payment Verified",
                paymentId: "pay_mock",
                orderId: orderId
            };
        }
    }
};
