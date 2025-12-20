export const typeDefs = `#graphql
  enum Role {
    user
    operator
    admin
    superadmin
  }

  enum VehicleType {
    TWO_WHEELER
    FOUR_WHEELER
    SUV
  }

  input VehicleInput {
    registrationNumber: String!
    type: VehicleType!
  }

  type User {
    uid: ID!
    name: String
    email: String!
    vehicle_make: String
    vehicle_plate: String
    role: Role!
  }

  type Coordinates {
    lat: Float!
    lng: Float!
  }

  type ParkingSlot {
    id: String!
    status: String!
  }

  type ParkingLot {
    id: ID!
    name: String!
    address: String!
    totalSlots: Int!
    availableSlots: Int!
    pricePerHour: Float!
    coords: Coordinates!
    slots: [ParkingSlot!]!
  }

  type ParkingLotInfo {
    name: String!
    address: String!
    totalSlots: Int!
  }

  type Booking {
    id: ID!
    userId: String
    lotId: String!
    parkingLotInfo: ParkingLotInfo!
    slotNumber: String!
    startTime: String!
    endTime: String!
    durationHours: Int!
    totalAmount: Float!
    status: String!
    bookingType: String
    walkInName: String
    walkInPhone: String
  }

  type AdminStats {
    totalUsers: Int!
    totalLots: Int!
    activeBookings: Int!
    completedBookings: Int!
  }

  type VerifyBookingResponse {
      success: Boolean!
      message: String!
      details: String
  }

  type PaymentOrder {
      orderId: ID!
      amount: Float!
      currency: String!
      bookingId: String!
      status: String!
  }

  type PaymentResult {
      success: Boolean!
      message: String!
      paymentId: String
      orderId: String
  }

  type SlotAvailability {
    lotId: ID!
    totalSpots: Int!
    availableSpots: Int!
    availableSlotIds: [String!]!
    hasAvailability: Boolean!
  }

  type BookingActionResponse {
    success: Boolean!
    message: String!
    bookingId: ID!
  }

  type Query {
    me: User
    parkingLots: [ParkingLot!]!
    myBookings: [Booking!]!
    allUsers: [User!]!
    adminStats: AdminStats!
    checkSlotAvailability(lotId: ID!): SlotAvailability!
  }

  type Mutation {
    setupProfile(name: String!, vehicle: VehicleInput!): User!
    
    # Role Management
    assignRole(userId: ID!, role: Role!): User!
    createAdmin(email: String!, name: String!): User!

    # Parking Lot Management
    addParkingLot(name: String!, address: String!, totalSlots: Int!, pricePerHour: Float!, lat: Float!, lng: Float!, slotPrefix: String!): ParkingLot!
    
    createBooking(lotId: ID!, slot: String!, duration: Int!): Booking!
    
    # Operator Booking
    createOperatorBooking(lotId: ID!, slot: String, duration: Int!, walkInName: String!, walkInPhone: String): Booking!
    
    cancelBooking(bookingId: ID!): BookingActionResponse!
    completeBooking(bookingId: ID!): BookingActionResponse!
    
    verifyBooking(bookingId: ID!): Booking!
    
    # Payment Mock Mutations
    createPaymentOrder(bookingId: ID!): PaymentOrder!
    payOrder(orderId: ID!): PaymentResult!
    verifyPayment(orderId: ID!): PaymentResult!
    
    # Operator Assignment
    assignOperator(userId: ID!, lotId: ID!): Boolean!
    revokeOperator(userId: ID!, lotId: ID!): Boolean!
    
    # Maintenance / Repair
    initializeSlots(lotId: ID!, prefix: String): Boolean!
  }
`;
