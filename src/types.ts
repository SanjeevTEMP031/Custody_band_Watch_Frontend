export type PersonStatus =
  | 'ONLINE'
  | 'MOVING'
  | 'STATIONARY'
  | 'OFFLINE'
  | 'ON_BREAK'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'EMERGENCY'

export type AlertSeverity = 'Low' | 'Medium' | 'High' | 'Critical'
export type NotificationStatus = 'Read' | 'Unread'

export interface Person {
  id: string
  name: string
  employeeId: string
  email: string
  phone: string
  department: string
  designation: string
  status: PersonStatus
  manager: string
  joiningDate: string
  workLocation: string
  currentLocation: string
  lastUpdated: string
  battery: number
  accuracy: number
  avatar: string
  location: { lat: number; lng: number }
}

export interface AttendanceRecord {
  id: string
  person: string
  employeeId: string
  checkIn: string
  checkOut: string
  workingHours: string
  status: 'Present' | 'Absent' | 'Late' | 'Half Day' | 'Leave' | 'Work From Home'
  location: string
}

export interface LocationPoint {
  time: string
  place: string
  lat: number
  lng: number
}

export interface Geofence {
  id: string
  name: string
  type: 'Office' | 'Branch' | 'Warehouse' | 'Client Location' | 'Restricted Zone' | 'Custom Zone'
  location: string
  radius: string
  status: 'Active' | 'Disabled'
  center: { lat: number; lng: number }
}

export interface AlertItem {
  id: string
  time: string
  person: string
  alertType: string
  location: string
  severity: AlertSeverity
  status: 'Open' | 'Resolved' | 'Dismissed'
}

export interface NotificationItem {
  id: string
  title: string
  time: string
  status: NotificationStatus
  type: string
}

export interface UserRole {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER'
  lastActive: string
  status: 'Active' | 'Idle'
}

export interface DashboardMetric {
  title: string
  value: string
  delta: string
  tone: 'primary' | 'success' | 'warning' | 'error' | 'info'
}
