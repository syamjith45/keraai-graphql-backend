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

        allUsers: async (_: any, __: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['admin', 'superadmin']);
            const { data } = await supabase.from('profiles').select('*');
            return data?.map((u: any) => ({
                uid: u.id,
                name: u.full_name,
                email: u.email,
                role: u.role,
                vehicle_make: u.vehicle_make,
                vehicle_plate: u.vehicle_plate
            })) || [];
        },

        adminStats: async (_: any, __: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['admin', 'superadmin']);
            return {
                totalUsers: 0,
                totalLots: 0,
                activeBookings: 0,
                completedBookings: 0
            };
        },

        // NEW: Check slot availability
        checkSlotAvailability: async (_: any, { lotId }: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            
            const { data: lot, error } = await supabase
                .from('parking_lots')
                .select('slots, available_spots, total_spots')
                .eq('id', lotId)
                .single();

            if (error || !lot) {
                throw new Error("Parking lot not found");
            }

            const slots = (lot.slots as Record<string, string>) || {};
            const availableSlots = Object.entries(slots)
                .filter(([_, status]) => status === 'available')
                .map(([id, _]) => id);

            return {
                lotId: lotId,
                totalSpots: lot.total_spots,
                availableSpots: lot.available_spots,
                availableSlotIds: availableSlots,
                hasAvailability: lot.available_spots > 0
            };
        },
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

        // ============================================
        // UPDATED: Create Booking with Auto-Assign
        // ============================================
        createBooking: async (_: any, { lotId, slot, duration }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            if (!user) throw new Error("Unauthorized");

            // Step 1: Fetch parking lot details
            const { data: lot, error: lotError } = await supabase
                .from('parking_lots')
                .select('*')
                .eq('id', lotId)
                .single();

            if (lotError || !lot) {
                throw new Error("Parking lot not found.");
            }

            // Step 2: Check if there are available spots
            if (lot.available_spots <= 0) {
                throw new Error("No available spots in this parking lot.");
            }

            // Step 3: Determine which slot to assign
            let assignedSlot: string;
            let currentSlots = (lot.slots as Record<string, string>) || {};

            if (slot) {
                // Frontend provided a specific slot - validate it
                if (!currentSlots[slot]) {
                    throw new Error(`Slot ${slot} does not exist in this parking lot.`);
                }
                if (currentSlots[slot] !== 'available') {
                    throw new Error(`Slot ${slot} is not available.`);
                }
                assignedSlot = slot;
            } else {
                // Auto-assign: Find first available slot
                if (Object.keys(currentSlots).length === 0) {
                    // Slots not initialized - generate slot dynamically
                    console.warn(`Parking lot ${lotId} has empty slots. Generating slot dynamically.`);
                    const occupiedCount = lot.total_spots - lot.available_spots;
                    const slotNumber = occupiedCount + 1;
                    const row = String.fromCharCode(65 + Math.floor((slotNumber - 1) / 10)); // A, B, C...
                    const col = ((slotNumber - 1) % 10) + 1; // 1-10
                    assignedSlot = `${row}${col}`;
                    
                    // Initialize this slot in the slots object
                    currentSlots[assignedSlot] = 'occupied';
                } else {
                    // Find first available slot in existing slots
                    const availableSlot = Object.keys(currentSlots).find(key => currentSlots[key] === 'available');
                    
                    if (!availableSlot) {
                        throw new Error("All slots are occupied. Please try another parking lot.");
                    }
                    assignedSlot = availableSlot;
                }
            }

            // Step 4: Mark slot as occupied
            currentSlots[assignedSlot] = 'occupied';

            // Step 5: Update parking lot (atomic operation)
            const { error: updateError } = await supabase
                .from('parking_lots')
                .update({
                    slots: currentSlots,
                    available_spots: lot.available_spots - 1
                })
                .eq('id', lotId)
                .eq('available_spots', lot.available_spots); // Optimistic concurrency check

            if (updateError) {
                console.error('Failed to update parking lot:', updateError);
                throw new Error("Failed to reserve slot. Please try again.");
            }

            // Step 6: Calculate start and end times
            const startTime = new Date();
            const endTime = new Date(startTime.getTime() + duration * 3600 * 1000);

            // Step 7: Create booking record
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .insert({
                    user_id: user.uid,
                    lot_id: lotId,
                    start_time: startTime.toISOString(),
                    end_time: endTime.toISOString(),
                    total_cost: lot.hourly_rate * duration,
                    status: 'pending',
                    qr_code_data: `${lot.id}_${assignedSlot}`
                })
                .select('*, parking_lots(name, address)')
                .single();

            if (bookingError) {
                // Rollback: Release the slot
                console.error('Booking creation failed, rolling back slot assignment:', bookingError);
                currentSlots[assignedSlot] = 'available';
                await supabase
                    .from('parking_lots')
                    .update({
                        slots: currentSlots,
                        available_spots: lot.available_spots
                    })
                    .eq('id', lotId);
                
                throw new Error(`Failed to create booking: ${bookingError.message}`);
            }

            // Step 8: Return booking response
            return {
                id: booking.id,
                userId: booking.user_id,
                lotId: booking.lot_id,
                parkingLotInfo: { 
                    name: booking.parking_lots.name, 
                    address: booking.parking_lots.address,
                    totalSlots: lot.total_spots
                },
                slotNumber: assignedSlot,
                startTime: booking.start_time,
                endTime: booking.end_time,
                durationHours: duration,
                totalAmount: booking.total_cost,
                status: 'ACTIVE'
            };
        },

        // ============================================
        // NEW: Create Operator Booking (Walk-in Users)
        // ============================================
        createOperatorBooking: async (_: any, { lotId, slot, duration, walkInName, walkInPhone }: any, { user, supabase }: ContextValue) => {
            // Only operators, admins, and superadmins can create walk-in bookings
            if (!user) throw new Error("Unauthorized");
            requireRole(user, ['operator', 'admin', 'superadmin']);

            // Step 1: Fetch parking lot details
            const { data: lot, error: lotError } = await supabase
                .from('parking_lots')
                .select('*')
                .eq('id', lotId)
                .single();

            if (lotError || !lot) {
                throw new Error("Parking lot not found.");
            }

            // Step 2: If user is an operator, verify they're assigned to this lot
            if (user.role === 'operator') {
                const { data: assignment, error: assignmentError } = await supabase
                    .from('operator_assignments')
                    .select('id')
                    .eq('operator_id', user.uid)
                    .eq('lot_id', lotId)
                    .single();

                if (assignmentError || !assignment) {
                    throw new Error("Access Denied: You are not assigned to manage this parking lot.");
                }
            }

            // Step 3: Check if there are available spots
            if (lot.available_spots <= 0) {
                throw new Error("No available spots in this parking lot.");
            }

            // Step 4: Determine which slot to assign
            let assignedSlot: string;
            let currentSlots = (lot.slots as Record<string, string>) || {};

            if (slot) {
                // Operator selected a specific slot - validate it
                if (!currentSlots[slot]) {
                    throw new Error(`Slot ${slot} does not exist in this parking lot.`);
                }
                if (currentSlots[slot] !== 'available') {
                    throw new Error(`Slot ${slot} is not available.`);
                }
                assignedSlot = slot;
            } else {
                // Auto-assign: Find first available slot
                if (Object.keys(currentSlots).length === 0) {
                    // Slots not initialized - generate slot dynamically
                    console.warn(`Parking lot ${lotId} has empty slots. Generating slot dynamically.`);
                    const occupiedCount = lot.total_spots - lot.available_spots;
                    const slotNumber = occupiedCount + 1;
                    const row = String.fromCharCode(65 + Math.floor((slotNumber - 1) / 10)); // A, B, C...
                    const col = ((slotNumber - 1) % 10) + 1; // 1-10
                    assignedSlot = `${row}${col}`;
                    currentSlots[assignedSlot] = 'occupied';
                } else {
                    // Find first available slot
                    const availableSlot = Object.keys(currentSlots).find(key => currentSlots[key] === 'available');
                    
                    if (!availableSlot) {
                        throw new Error("All slots are occupied. Please try another parking lot.");
                    }
                    assignedSlot = availableSlot;
                }
            }

            // Step 5: Mark slot as occupied
            currentSlots[assignedSlot] = 'occupied';

            // Step 6: Update parking lot
            const { error: updateError } = await supabase
                .from('parking_lots')
                .update({
                    slots: currentSlots,
                    available_spots: lot.available_spots - 1
                })
                .eq('id', lotId)
                .eq('available_spots', lot.available_spots); // concurrency control

            if (updateError) {
                console.error('Failed to update parking lot:', updateError);
                throw new Error("Failed to reserve slot. Please try again.");
            }

            // Step 7: Calculate times
            const startTime = new Date();
            const endTime = new Date(startTime.getTime() + duration * 3600 * 1000);

            // Step 8: Create booking for walk-in user
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .insert({
                    user_id: null,
                    lot_id: lotId,
                    start_time: startTime.toISOString(),
                    end_time: endTime.toISOString(),
                    total_cost: lot.hourly_rate * duration,
                    status: 'active',
                    qr_code_data: `${lot.id}_${assignedSlot}`,
                    booking_type: 'walk_in',
                    walk_in_name: walkInName,
                    walkInPhone: walkInPhone || null,
                    booked_by: user.uid
                })
                .select('*, parking_lots(name, address)')
                .single();

            if (bookingError) {
                // Rollback
                console.error('Booking creation failed, rolling back:', bookingError);
                currentSlots[assignedSlot] = 'available';
                await supabase
                    .from('parking_lots')
                    .update({
                        slots: currentSlots,
                        available_spots: lot.available_spots
                    })
                    .eq('id', lotId);
                
                throw new Error(`Failed to create booking: ${bookingError.message}`);
            }

            // Step 9: Return booking response
            return {
                id: booking.id,
                userId: null,
                lotId: booking.lot_id,
                parkingLotInfo: { 
                    name: booking.parking_lots.name, 
                    address: booking.parking_lots.address,
                    totalSlots: lot.total_spots
                },
                slotNumber: assignedSlot,
                startTime: booking.start_time,
                endTime: booking.end_time,
                durationHours: duration,
                totalAmount: booking.total_cost,
                status: 'ACTIVE',
                bookingType: 'walk_in',
                walkInName: walkInName,
                walkInPhone: walkInPhone
            };
        },

        // ============================================
        // NEW: Cancel Booking
        // ============================================
        cancelBooking: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            
            // Fetch booking
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('id, user_id, lot_id, qr_code_data, status')
                .eq('id', bookingId)
                .single();

            if (bookingError || !booking) {
                throw new Error("Booking not found");
            }

            // Check if user owns this booking (unless admin/operator)
            if (user.role === 'user' && booking.user_id !== user.uid) {
                throw new Error("You can only cancel your own bookings");
            }

            if (booking.status === 'completed' || booking.status === 'cancelled') {
                throw new Error("Cannot cancel a completed or already cancelled booking");
            }

            // Extract slot
            const slotNumber = booking.qr_code_data?.split('_')[1];
            
            // Update booking to cancelled
            const { error: updateError } = await supabase
                .from('bookings')
                .update({ status: 'cancelled' })
                .eq('id', bookingId);

            if (updateError) {
                throw new Error(`Failed to cancel booking: ${updateError.message}`);
            }

            // Release the slot if it exists
            if (slotNumber) {
                const { data: lot, error: lotError } = await supabase
                    .from('parking_lots')
                    .select('slots, available_spots')
                    .eq('id', booking.lot_id)
                    .single();

                if (!lotError && lot) {
                    const currentSlots = (lot.slots as Record<string, string>) || {};
                    
                    if (currentSlots[slotNumber]) {
                        currentSlots[slotNumber] = 'available';
                        
                        await supabase
                            .from('parking_lots')
                            .update({
                                slots: currentSlots,
                                available_spots: lot.available_spots + 1
                            })
                            .eq('id', booking.lot_id);
                    }
                }
            }

            return {
                success: true,
                message: "Booking cancelled successfully",
                bookingId: booking.id
            };
        },

        // ============================================
        // NEW: Complete Booking
        // ============================================
        completeBooking: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['operator', 'admin', 'superadmin']);
            
            // Fetch booking to get lot_id and qr_code_data (which contains slot info)
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('id, lot_id, qr_code_data, status')
                .eq('id', bookingId)
                .single();

            if (bookingError || !booking) {
                throw new Error("Booking not found");
            }

            // Extract slot from qr_code_data (format: "lotId_slotNumber")
            const slotNumber = booking.qr_code_data?.split('_')[1];
            if (!slotNumber) {
                throw new Error("Invalid booking data");
            }

            // Update booking status
            const { error: updateBookingError } = await supabase
                .from('bookings')
                .update({ status: 'completed' })
                .eq('id', bookingId);

            if (updateBookingError) {
                throw new Error(`Failed to complete booking: ${updateBookingError.message}`);
            }

            // Release the slot
            const { data: lot, error: lotError } = await supabase
                .from('parking_lots')
                .select('slots, available_spots')
                .eq('id', booking.lot_id)
                .single();

            if (lotError || !lot) {
                throw new Error("Parking lot not found");
            }

            const currentSlots = (lot.slots as Record<string, string>) || {};
            
            if (currentSlots[slotNumber]) {
                currentSlots[slotNumber] = 'available';
                
                await supabase
                    .from('parking_lots')
                    .update({
                        slots: currentSlots,
                        available_spots: lot.available_spots + 1
                    })
                    .eq('id', booking.lot_id);
            }

            return {
                success: true,
                message: "Booking completed and slot released",
                bookingId: booking.id
            };
        },

        // ============================================
        // EXISTING MUTATIONS (Keep as is)
        // ============================================
        assignRole: async (_: any, { userId, role }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['superadmin']);
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
            throw new Error("Create Admin requires separate Auth implementation.");
        },

        addParkingLot: async (_: any, args: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['admin', 'superadmin']);
            
            const slotsData: Record<string, string> = {};
            const prefix = args.slotPrefix || 'A';
            for (let i = 1; i <= args.totalSlots; i++) {
                slotsData[`${prefix}${i}`] = 'available';
            }

            const { data, error } = await supabase.from('parking_lots').insert({
                name: args.name,
                address: args.address,
                total_spots: args.totalSlots,
                available_spots: args.totalSlots,
                hourly_rate: args.pricePerHour,
                latitude: args.lat,
                longitude: args.lng,
                slots: slotsData
            }).select().single();

            if (error) throw new Error(error.message);
            
            const slotsArray = Object.entries(slotsData).map(([id, status]) => ({ id, status }));

            return {
                id: data.id,
                name: data.name,
                address: data.address,
                totalSlots: data.total_spots,
                availableSlots: data.available_spots,
                pricePerHour: data.hourly_rate,
                coords: { lat: data.latitude, lng: data.longitude },
                slots: slotsArray
            };
        },

        initializeSlots: async (_: any, { lotId, prefix }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['admin', 'superadmin']);
            
            const { data: lot, error: lotError } = await supabase.from('parking_lots').select('*').eq('id', lotId).single();
            if (lotError || !lot) throw new Error("Lot not found");

            const p = prefix || 'A';
            const slotsData: Record<string, string> = {};
            for (let i = 1; i <= lot.total_spots; i++) {
                slotsData[`${p}${i}`] = 'available';
            }

             const { error } = await supabase.from('parking_lots').update({
                slots: slotsData,
                available_spots: lot.total_spots
            }).eq('id', lotId);

            if (error) throw new Error(error.message);
            return true;
        },

        verifyBooking: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            requireRole(user, ['operator', 'admin', 'superadmin']);
            
            // 1. Fetch the booking with parking lot info
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('*, parking_lots(name, address, total_spots)')
                .eq('id', bookingId)
                .single();

            if (bookingError || !booking) throw new Error("Booking not found");

            // 2. If user is an operator, verify they're assigned to this lot
            if (user.role === 'operator') {
                const { data: assignment, error: assignmentError } = await supabase
                    .from('operator_assignments')
                    .select('id')
                    .eq('operator_id', user.uid)
                    .eq('lot_id', booking.lot_id)
                    .single();

                if (assignmentError || !assignment) {
                    throw new Error("Access Denied: You are not assigned to manage this parking lot.");
                }
            }

            // 3. Status Check
            if (booking.status === 'completed') {
                throw new Error("Booking is already completed.");
            }
            if (booking.status === 'cancelled') {
                throw new Error("Booking is cancelled.");
            }

            // 4. Update status to 'active' (Checked In) if not already
            let updatedBooking = booking;
            if (booking.status !== 'active') {
                const { data, error } = await supabase
                    .from('bookings')
                    .update({ status: 'active' })
                    .eq('id', bookingId)
                    .select('*, parking_lots(name, address, total_spots)')
                    .single();
                
                if (error) throw new Error("Failed to update booking status.");
                updatedBooking = data;
            }

            // 5. Return Booking object
            return {
                id: updatedBooking.id,
                userId: updatedBooking.user_id,
                lotId: updatedBooking.lot_id,
                parkingLotInfo: { 
                    name: updatedBooking.parking_lots.name, 
                    address: updatedBooking.parking_lots.address,
                    totalSlots: updatedBooking.parking_lots.total_spots || 0 // Default or fetch if needed
                },
                slotNumber: updatedBooking.qr_code_data?.split('_')[1] || "N/A",
                startTime: updatedBooking.start_time,
                endTime: updatedBooking.end_time,
                durationHours: 0, // Calculate if needed, but schema says Int!
                totalAmount: updatedBooking.total_cost,
                status: 'ACTIVE', // Return normalized status
                bookingType: updatedBooking.booking_type,
                walkInName: updatedBooking.walk_in_name,
                walkInPhone: updatedBooking.walk_in_phone
            };
        },

        createPaymentOrder: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            return {
                orderId: "ord_" + Math.random().toString(36).substr(2, 9),
                amount: 10.0,
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
        },

        assignOperator: async (_: any, { userId, lotId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['admin', 'superadmin']);
            
            const { data: targetUser, error: userError } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', userId)
                .single();
                
            if (userError || !targetUser) throw new Error("User not found");
            if (targetUser.role !== 'operator') throw new Error("Target user is not an operator");

            const { error } = await supabase
                .from('operator_assignments')
                .insert({ operator_id: userId, lot_id: lotId });

            if (error) {
                if (error.code === '23505') throw new Error("Operator already assigned to this lot");
                throw new Error(error.message);
            }
            return true;
        },

        revokeOperator: async (_: any, { userId, lotId }: any, { user, supabase }: ContextValue) => {
             requireRole(user, ['admin', 'superadmin']);
             const { error } = await supabase
                .from('operator_assignments')
                .delete()
                .match({ operator_id: userId, lot_id: lotId });

             if (error) throw new Error(error.message);
             return true;
        }
    }
};