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
    userId: String!
    lotId: String!
    parkingLotInfo: ParkingLotInfo!
    slotNumber: String!
    startTime: String!
    endTime: String!
    durationHours: Int!
    totalAmount: Float!
    status: String!
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

  type Query {
    me: User
    parkingLots: [ParkingLot!]!
    myBookings: [Booking!]!
    allUsers: [User!]!
    adminStats: AdminStats!
  }

  type Mutation {
    setupProfile(name: String!, vehicle: VehicleInput!): User!
    
    # Role Management
    assignRole(userId: ID!, role: Role!): User!
    createAdmin(email: String!, name: String!): User!

    # Parking Lot Management
    addParkingLot(name: String!, address: String!, totalSlots: Int!, pricePerHour: Float!, lat: Float!, lng: Float!, slotPrefix: String!): ParkingLot!
    
    createBooking(lotId: ID!, slot: String!, duration: Int!): Booking!
    verifyBooking(bookingId: ID!): VerifyBookingResponse!
    
    # Payment Mock Mutations
    createPaymentOrder(bookingId: ID!): PaymentOrder!
    payOrder(orderId: ID!): PaymentResult!
    verifyPayment(orderId: ID!): PaymentResult!
  }
`;
