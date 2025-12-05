import { ContextValue, BookingStatus } from "../types";

export const resolvers = {
    Query: {
        me: async (_: any, __: any, { user, supabase }: ContextValue) => {
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
            return data?.map(lot => {
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

            return data?.map(b => ({
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

        // ... Add payment mutations and addParkingLot here
    }
};
