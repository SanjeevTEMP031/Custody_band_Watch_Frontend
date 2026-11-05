import { Navigate, Route, Routes } from 'react-router-dom'
import { useSelector } from 'react-redux'
import type { RootState } from '../store/store'
import AppShell from '../components/layout/AppShell'
import LoginPage from '../pages/auth/LoginPage'
import DashboardPage from '../pages/dashboard/DashboardPage'
import LivePeoplePage from '../pages/livePeople/LivePeoplePage'
import PeoplePage from '../pages/people/PeoplePage'
import AttendancePage from '../pages/attendance/AttendancePage'
import LocationHistoryPage from '../pages/locationHistory/LocationHistoryPage'
import GeofencesPage from '../pages/geofences/GeofencesPage'
import AlertsPage from '../pages/alerts/AlertsPage'
import NotificationsPage from '../pages/notifications/NotificationsPage'
import ReportsPage from '../pages/reports/ReportsPage'
import UsersPage from '../pages/users/UsersPage'
import SettingsPage from '../pages/settings/SettingsPage'
import DeviceManagementPage from '../pages/devices/DeviceManagementPage'
import HealthDataPage from '../pages/devices/HealthDataPage'
import AddDevicePage from '../pages/devices/AddDevicePage'
import BulkSellPage from '../pages/devices/BulkSellPage'
import SimCardManagementPage from '../pages/devices/SimCardManagementPage'
import AlarmStatisticsPage from '../pages/statistics/AlarmStatisticsPage'
import DeviceStatisticsPage from '../pages/statistics/DeviceStatisticsPage'
import UserStatisticsPage from '../pages/statistics/UserStatisticsPage'
import SelfHelpIntegrationPage from '../pages/selfService/SelfHelpIntegrationPage'
import RedeemVoucherPage from '../pages/selfService/RedeemVoucherPage'
import LandingPage from '../pages/public/LandingPage'

function ProtectedRoute({ children, requireAuth = true }: { children: React.ReactNode; requireAuth?: boolean }) {
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated)

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/admin/login" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/admin/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute requireAuth={false}>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/admin/dashboard" element={<DashboardPage />} />
        <Route path="/admin/monitoring-center" element={<LivePeoplePage />} />
        <Route path="/admin/device-management" element={<DeviceManagementPage />} />
        <Route path="/admin/health-data" element={<HealthDataPage />} />
        <Route path="/admin/geofence" element={<HealthDataPage geofenceView />} />
        <Route path="/admin/add-device" element={<AddDevicePage />} />
        <Route path="/admin/bulk-sell" element={<BulkSellPage />} />
        <Route path="/admin/sim-cards" element={<SimCardManagementPage />} />
        <Route path="/admin/live-people" element={<LivePeoplePage />} />
        <Route path="/admin/people" element={<PeoplePage />} />
        <Route path="/admin/attendance" element={<AttendancePage />} />
        <Route path="/admin/location-history" element={<LocationHistoryPage />} />
        <Route path="/admin/geofences" element={<GeofencesPage />} />
        <Route path="/admin/alerts" element={<AlertsPage />} />
        <Route path="/admin/alarm-statistics" element={<AlarmStatisticsPage />} />
        <Route path="/admin/device-statistics" element={<DeviceStatisticsPage />} />
        <Route path="/admin/user-statistics" element={<UserStatisticsPage />} />
        <Route path="/admin/notifications" element={<NotificationsPage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="/admin/self-help-integration" element={<SelfHelpIntegrationPage />} />
        <Route path="/admin/redeem-voucher" element={<RedeemVoucherPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
  )
}

export default AppRoutes
