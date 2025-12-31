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
                status: b.status.toUpperCase(),
                vehicleNumber: b.vehicle_number
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

        // UPDATED: Time-based availability check using DB Function
        checkSlotAvailability: async (_: any, { lotId, startTime, endTime }: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            
            const start = startTime ? new Date(startTime).toISOString() : new Date().toISOString();
            const end = endTime ? new Date(endTime).toISOString() : new Date(Date.now() + 2 * 3600 * 1000).toISOString();

            // 1. Get total spots from parking_lots table
            const { data: lot, error: lotError } = await supabase
                .from('parking_lots')
                .select('total_spots, available_spots')
                .eq('id', lotId)
                .single();

            if (lotError || !lot) throw new Error("Parking lot not found");

            // 2. Call RPC to get available slots
            const { data: availableSlotIds, error: rpcError } = await supabase
                .rpc('get_available_slots', {
                    p_lot_id: lotId,
                    p_start_time: start,
                    p_end_time: end
                });

            if (rpcError) {
                console.error("RPC Error:", rpcError);
                throw new Error("Failed to check availability");
            }

            const availableCount = availableSlotIds ? availableSlotIds.length : 0;

            return {
                lotId: lotId,
                totalSpots: lot.total_spots,
                availableSpots: availableCount,
                availableSlotIds: availableSlotIds || [],
                hasAvailability: availableCount > 0
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
        // UPDATED: Create Booking (Using DB Logic)
        // ============================================
        createBooking: async (_: any, { lotId, slot, startTime, duration, vehicleNumber }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            if (!user) throw new Error("Unauthorized");
            if (!lotId) throw new Error("Parking Lot ID is required");

            const bookingStart = startTime ? new Date(startTime).toISOString() : new Date().toISOString();
            const bookingEnd = new Date(new Date(bookingStart).getTime() + duration * 3600 * 1000).toISOString();

            // 1. If slot is provided, validate it. If not, auto-assign.
            let targetSlot = slot;
            
            if (!targetSlot) {
                 const { data: availableSlots, error: rpcError } = await supabase
                    .rpc('get_available_slots', {
                        p_lot_id: lotId,
                        p_start_time: bookingStart,
                        p_end_time: bookingEnd
                    });
                
                if (rpcError || !availableSlots || availableSlots.length === 0) {
                     throw new Error("No slots available for the requested time.");
                }
                targetSlot = availableSlots[0];
            } else {
                 // Verify specific slot availability
                 const { data: isAvailable, error: checkError } = await supabase
                    .rpc('is_slot_available', {
                        p_lot_id: lotId,
                        p_slot_number: targetSlot,
                        p_start_time: bookingStart,
                        p_end_time: bookingEnd
                    });
                
                if (checkError || !isAvailable) {
                    throw new Error(`Slot ${targetSlot} is not available.`);
                }
            }

            // 2. Fetch lot details for price (and optimistic concurrency update later)
            const { data: lot, error: lotError } = await supabase
                .from('parking_lots')
                .select('*')
                .eq('id', lotId)
                .single();

            if (lotError || !lot) throw new Error("Parking lot not found.");

            // Resolve Vehicle Number (Fallback to profile if not provided)
            let finalVehicleNumber = vehicleNumber;
            if (!finalVehicleNumber) {
                 const { data: profile } = await supabase.from('profiles').select('vehicle_plate').eq('id', user.uid).single();
                 finalVehicleNumber = profile?.vehicle_plate;
            }

            // 3. Create Booking
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .insert({
                    user_id: user.uid,
                    lot_id: lotId,
                    start_time: bookingStart,
                    end_time: bookingEnd,
                    total_cost: lot.hourly_rate * duration,
                    status: 'pending',
                    qr_code_data: `${lotId}_${targetSlot}`,
                    booking_type: 'self',
                    vehicle_number: finalVehicleNumber
                })
                .select('*, parking_lots(name, address)')
                .single();

            if (bookingError) {
                console.error("Booking failed:", bookingError);
                throw new Error(`Booking failed: ${bookingError.message}`);
            }

            // 4. Update Cache (Best Effort)
            // We call the sync function to let the DB handle the cache consistency
            await supabase.rpc('sync_lot_cache', { p_lot_id: lotId });

            return {
                id: booking.id,
                userId: booking.user_id,
                lotId: booking.lot_id,
                parkingLotInfo: { 
                    name: booking.parking_lots.name, 
                    address: booking.parking_lots.address,
                    totalSlots: lot.total_spots
                },
                slotNumber: targetSlot,
                startTime: booking.start_time,
                endTime: booking.end_time,
                durationHours: duration,
                totalAmount: booking.total_cost,
                status: 'PENDING',
                vehicleNumber: booking.vehicle_number
            };
        },

        // ============================================
        // UPDATED: Create Operator Booking (Walk-in)
        // ============================================
        createOperatorBooking: async (_: any, { lotId, slot, startTime, duration, walkInName, walkInPhone, vehicleNumber }: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            requireRole(user, ['operator', 'admin', 'superadmin']);

            // Verify assignment if operator
            if (user.role === 'operator') {
                const { data: assignment } = await supabase
                    .from('operator_assignments')
                    .select('id')
                    .eq('operator_id', user.uid)
                    .eq('lot_id', lotId)
                    .single();
                 if (!assignment) throw new Error("Access Denied: Not assigned to this lot.");
            }

            const bookingStart = startTime ? new Date(startTime).toISOString() : new Date().toISOString();
            const bookingEnd = new Date(new Date(bookingStart).getTime() + duration * 3600 * 1000).toISOString();

            // 1. Slot Assignment
            let targetSlot = slot;
            if (!targetSlot) {
                 const { data: availableSlots } = await supabase
                    .rpc('get_available_slots', {
                        p_lot_id: lotId,
                        p_start_time: bookingStart,
                        p_end_time: bookingEnd
                    });
                if (!availableSlots || availableSlots.length === 0) throw new Error("No slots available.");
                targetSlot = availableSlots[0];
            } else {
                 const { data: isAvailable } = await supabase
                    .rpc('is_slot_available', {
                        p_lot_id: lotId,
                        p_slot_number: targetSlot,
                        p_start_time: bookingStart,
                        p_end_time: bookingEnd
                    });
                if (!isAvailable) throw new Error(`Slot ${targetSlot} is not available.`);
            }

            // 2. Fetch lot for price
            const { data: lot } = await supabase.from('parking_lots').select('hourly_rate, total_spots').eq('id', lotId).single();
            if (!lot) throw new Error("Lot not found");

            // 3. Create Booking (Walk-ins are confirmed immediately)
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .insert({
                    user_id: null,
                    lot_id: lotId,
                    start_time: bookingStart,
                    end_time: bookingEnd,
                    total_cost: lot.hourly_rate * duration,
                    status: 'confirmed', 
                    qr_code_data: `${lotId}_${targetSlot}`,
                    booking_type: 'walk_in',
                    walk_in_name: walkInName,
                    walk_in_phone: walkInPhone || null,
                    booked_by: user.uid,
                    vehicle_number: vehicleNumber
                })
                .select('*, parking_lots(name, address)')
                .single();

             if (bookingError) throw new Error(bookingError.message);

            // 4. Update Cache
            await supabase.rpc('sync_lot_cache', { p_lot_id: lotId });

            return {
                id: booking.id,
                userId: null,
                lotId: booking.lot_id,
                parkingLotInfo: { 
                    name: booking.parking_lots.name, 
                    address: booking.parking_lots.address,
                    totalSlots: lot.total_spots
                },
                slotNumber: targetSlot,
                startTime: booking.start_time,
                endTime: booking.end_time,
                durationHours: duration,
                totalAmount: booking.total_cost,
                status: 'CONFIRMED',
                bookingType: 'walk_in',
                walkInName: walkInName,
                walkInPhone: walkInPhone,
                vehicleNumber: booking.vehicle_number
            };
        },

        // ============================================
        // UPDATED: Cancel Booking
        // ============================================
        cancelBooking: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('id, user_id, lot_id, qr_code_data, status, start_time')
                .eq('id', bookingId)
                .single();

            if (bookingError || !booking) {
                throw new Error("Booking not found");
            }

            // Authorization check
            if (user.role === 'user' && booking.user_id !== user.uid) {
                throw new Error("You can only cancel your own bookings");
            }

            if (booking.status === 'completed' || booking.status === 'cancelled') {
                throw new Error("Cannot cancel a completed or already cancelled booking");
            }

            // Update booking status
            const { error: updateError } = await supabase
                .from('bookings')
                .update({ status: 'cancelled' })
                .eq('id', bookingId);

            if (updateError) {
                throw new Error(`Failed to cancel booking: ${updateError.message}`);
            }

            // Update cache (best effort)
            const slotNumber = booking.qr_code_data?.split('_')[1];
            
            if (slotNumber) {
                try {
                    const { data: lot } = await supabase
                        .from('parking_lots')
                        .select('slots, available_spots')
                        .eq('id', booking.lot_id)
                        .single();

                    if (lot) {
                        // Check if any other confirmed bookings exist for this slot
                        const { data: otherBookings } = await supabase
                            .from('bookings')
                            .select('id')
                            .eq('lot_id', booking.lot_id)
                            .eq('qr_code_data', booking.qr_code_data)
                            .in('status', ['pending', 'confirmed'])
                            .neq('id', bookingId);

                        if (!otherBookings || otherBookings.length === 0) {
                            const updatedSlots = { ...(lot.slots as Record<string, string>) };
                            updatedSlots[slotNumber] = 'available';
                            
                            await supabase
                                .from('parking_lots')
                                .update({
                                    slots: updatedSlots,
                                    available_spots: Math.min(
                                        lot.available_spots + 1,
                                        Object.keys(updatedSlots).length
                                    )
                                })
                                .eq('id', booking.lot_id);
                        }
                    }
                } catch (error) {
                    console.warn('[Cache update failed - non-critical]', error);
                }
            }

            return {
                success: true,
                message: "Booking cancelled successfully",
                bookingId: booking.id
            };
        },

        // ============================================
        // UPDATED: Complete Booking
        // ============================================
        completeBooking: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['operator', 'admin', 'superadmin']);
            
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('id, lot_id, qr_code_data, status')
                .eq('id', bookingId)
                .single();

            if (bookingError || !booking) {
                throw new Error("Booking not found");
            }

            if (booking.status === 'completed') {
                throw new Error("Booking already completed");
            }

            if (booking.status === 'cancelled') {
                throw new Error("Cannot complete a cancelled booking");
            }

            const slotNumber = booking.qr_code_data?.split('_')[1];

            // Update booking status
            const { error: updateError } = await supabase
                .from('bookings')
                .update({ status: 'completed' })
                .eq('id', bookingId);

            if (updateError) {
                throw new Error(`Failed to complete booking: ${updateError.message}`);
            }

            // Release the slot (update cache)
            if (slotNumber) {
                try {
                    const { data: lot } = await supabase
                        .from('parking_lots')
                        .select('slots, available_spots')
                        .eq('id', booking.lot_id)
                        .single();

                    if (lot) {
                        // Check if any other confirmed bookings exist for this slot
                        const { data: otherBookings } = await supabase
                            .from('bookings')
                            .select('id')
                            .eq('lot_id', booking.lot_id)
                            .eq('qr_code_data', booking.qr_code_data)
                            .in('status', ['pending', 'confirmed'])
                            .neq('id', bookingId);

                        if (!otherBookings || otherBookings.length === 0) {
                            const updatedSlots = { ...(lot.slots as Record<string, string>) };
                            updatedSlots[slotNumber] = 'available';
                            
                            await supabase
                                .from('parking_lots')
                                .update({
                                    slots: updatedSlots,
                                    available_spots: Math.min(
                                        lot.available_spots + 1,
                                        Object.keys(updatedSlots).length
                                    )
                                })
                                .eq('id', booking.lot_id);
                        }
                    }
                } catch (error) {
                    console.warn('[Cache update failed - non-critical]', error);
                }
            }

            return {
                success: true,
                message: "Booking completed and slot released",
                bookingId: booking.id
            };
        },

        // ============================================
        // UPDATED: Verify Booking (QR Scan)
        // ============================================
        verifyBooking: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            if (!user) throw new Error("Unauthorized");
            requireRole(user, ['operator', 'admin', 'superadmin']);
            
            // Fetch the booking with parking lot info
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('*, parking_lots(name, address, total_spots)')
                .eq('id', bookingId)
                .single();

            if (bookingError || !booking) throw new Error("Booking not found");

            // If user is an operator, verify they're assigned to this lot
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

            // Status Check
            if (booking.status === 'completed') {
                throw new Error("Booking is already completed.");
            }
            if (booking.status === 'cancelled') {
                throw new Error("Booking is cancelled.");
            }

            // Update status to 'confirmed' (Checked In) if it's 'pending'
            let updatedBooking = booking;
            if (booking.status === 'pending') {
                const { data, error } = await supabase
                    .from('bookings')
                    .update({ status: 'confirmed' })
                    .eq('id', bookingId)
                    .select('*, parking_lots(name, address, total_spots)')
                    .single();
                
                if (error) throw new Error("Failed to update booking status.");
                updatedBooking = data;
            }

            // Return Booking object
            return {
                id: updatedBooking.id,
                userId: updatedBooking.user_id,
                lotId: updatedBooking.lot_id,
                parkingLotInfo: { 
                    name: updatedBooking.parking_lots.name, 
                    address: updatedBooking.parking_lots.address,
                    totalSlots: updatedBooking.parking_lots.total_spots || 0
                },
                slotNumber: updatedBooking.qr_code_data?.split('_')[1] || "N/A",
                startTime: updatedBooking.start_time,
                endTime: updatedBooking.end_time,
                durationHours: 0,
                totalAmount: updatedBooking.total_cost,
                status: 'CONFIRMED',
                bookingType: updatedBooking.booking_type,
                walkInName: updatedBooking.walk_in_name,
                walkInPhone: updatedBooking.walk_in_phone,
                vehicleNumber: updatedBooking.vehicle_number
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

        createPaymentOrder: async (_: any, { bookingId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            if (!user) throw new Error("Unauthorized");

            // 1) Get booking
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('id, user_id, total_cost, status')
                .eq('id', bookingId)
                .single();

            if (bookingError || !booking) {
                throw new Error("Booking not found");
            }

            if (booking.status !== 'pending') {
                throw new Error("Only pending bookings can be paid");
            }

            const amount = booking.total_cost;

            // 2) Create payment row
            const mockProviderId = "mock_ord_" + Math.random().toString(36).substr(2, 9);

            const { data: payment, error: paymentError } = await supabase
                .from('payments')
                .insert({
                    booking_id: booking.id,
                    user_id: booking.user_id || user.uid,
                    amount,
                    status: 'pending',
                    provider_id: mockProviderId,
                })
                .select()
                .single();

            if (paymentError || !payment) {
                throw new Error("Failed to create payment order");
            }

            // 3) Return order info
            return {
                orderId: payment.id,
                amount: payment.amount,
                currency: "INR",
                bookingId: bookingId,
                status: "PENDING"
            };
        },

        payOrder: async (_: any, { orderId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);

            // 1) Find payment row
            const { data: payment, error: paymentError } = await supabase
                .from('payments')
                .select('id, booking_id, status, provider_id')
                .eq('id', orderId)
                .single();

            if (paymentError || !payment) {
                throw new Error("Payment order not found");
            }

            if (payment.status === 'success') {
                return {
                    success: true,
                    message: "Payment already successful",
                    paymentId: payment.id,
                    orderId
                };
            }

            // 2) Mock success
            const { error: updateError } = await supabase
                .from('payments')
                .update({
                    status: 'success',
                    provider_id: payment.provider_id || 'mock_provider'
                })
                .eq('id', orderId);

            if (updateError) {
                throw new Error("Failed to update payment status");
            }

            // 3) Update booking to confirmed
            await supabase
                .from('bookings')
                .update({ status: 'confirmed' })
                .eq('id', payment.booking_id)
                .eq('status', 'pending');

            return {
                success: true,
                message: "Payment Successful (mock)",
                paymentId: payment.id,
                orderId
            };
        },

        verifyPayment: async (_: any, { orderId, bookingId }: any, { user, supabase }: ContextValue) => {
            requireRole(user, ['user', 'operator', 'admin', 'superadmin']);
            
            // IMPORTANT: After payment verification, update booking status to 'confirmed'
            if (bookingId) {
                await supabase
                    .from('bookings')
                    .update({ status: 'confirmed' })
                    .eq('id', bookingId)
                    .eq('status', 'pending'); // Only update if still pending
            }
            
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