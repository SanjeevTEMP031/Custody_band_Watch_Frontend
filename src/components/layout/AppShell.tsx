import { useState, useEffect } from 'react'
import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import {
  Menu,
  Bell,
  LogOut,
  ChevronDown,
  User as UserIcon,
} from 'lucide-react'
import type { RootState } from '../../store/store'
import { logout } from '../../store/authSlice'
import { clearAccessToken, listAlerts } from '../../services/api'
import Sidebar from './Sidebar'
import './appshell.css'

export default function AppShell() {
  const location = useLocation()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const auth = useSelector((state: RootState) => state.auth)

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('trackin360-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [alertCount, setAlertCount] = useState<number>(0)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)

  // Fetch active alerts count for badge
  useEffect(() => {
    let isMounted = true
    listAlerts(0, 100)
      .then(alerts => {
        if (!isMounted) return
        const active = (alerts || []).filter(a => (a.status || '').toLowerCase() !== 'resolved').length
        setAlertCount(active)
      })
      .catch(() => {})
    return () => { isMounted = false }
  }, [location.pathname])

  const handleToggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem('trackin360-sidebar-collapsed', String(next))
      } catch {}
      return next
    })
  }

  const handleLogout = () => {
    clearAccessToken()
    dispatch(logout())
    navigate('/admin/login', { replace: true })
  }

  // Derive readable page title
  const getPageTitle = () => {
    const p = location.pathname
    if (p.includes('/admin/dashboard')) return 'Enterprise Dashboard'
    if (p.includes('/admin/device-management')) return 'Device Management'
    if (p.includes('/admin/monitoring-center') || p.includes('/admin/live-people')) return 'Monitoring Center'
    if (p.includes('/admin/geofence') || p.includes('/admin/geofences')) return 'Geofence Security'
    if (p.includes('/admin/alerts') || p.includes('/admin/notifications')) return 'Security Alerts'
    if (p.includes('/admin/device-statistics') || p.includes('/admin/alarm-statistics')) return 'Statistics Center'
    if (p.includes('/admin/self-help-integration') || p.includes('/admin/redeem-voucher')) return 'Self-Service Portal'
    if (p.includes('/admin/reports')) return 'Information & Reports'
    if (p.includes('/admin/settings')) return 'System Settings'
    if (p.includes('/admin/health-data')) return 'Biometric Health Data'
    if (p.includes('/admin/add-device')) return 'Register New Device'
    return 'Trackin360'
  }

  const userDisplayName = auth.user?.name || 'Trackin360 Admin'
  const userRole = (auth.user as any)?.role || 'Super Admin'

  return (
    <div className="trackin-app-layout">
      {/* 1. Left Fixed Collapsible Sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        alertCount={alertCount}
      />

      {/* 2. Main Wrapper with Dynamic Margin */}
      <div className={'app-main-viewport ' + (collapsed ? 'sidebar-collapsed' : 'sidebar-expanded')}>
        {/* Modern Top Header Bar */}
        <header className="app-top-header">
          <div className="header-left">
            <button
              type="button"
              className="mobile-hamburger-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Open mobile navigation"
            >
              <Menu size={22} />
            </button>

            <div className="header-breadcrumb-wrap">
              <span className="breadcrumb-sub">Platform</span>
              <span className="breadcrumb-sep">/</span>
              <h1 className="header-page-title">{getPageTitle()}</h1>
            </div>
          </div>

          <div className="header-right">
            {/* Live System Status Pill */}
            <div className="system-status-pill" title="Backend API operational">
              <span className="status-pulse-dot" />
              <span className="status-text">Live Ops</span>
            </div>

            {/* Quick Alerts Bell */}
            <Link
              to="/admin/alerts"
              className="header-alert-btn"
              title={alertCount > 0 ? (alertCount + ' Active Alerts') : 'No Active Alerts'}
            >
              <Bell size={19} />
              {alertCount > 0 && (
                <span className="header-alert-badge">
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
            </Link>

            {/* User Profile Capsule */}
            <div className="user-profile-menu-wrap">
              <button
                type="button"
                className="user-profile-capsule"
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                aria-expanded={userDropdownOpen}
              >
                <div className="user-avatar-circle">
                  {userDisplayName.charAt(0).toUpperCase()}
                </div>
                <div className="user-info-text">
                  <span className="user-name">{userDisplayName}</span>
                  <span className="user-role">{userRole}</span>
                </div>
                <ChevronDown size={15} className="user-dropdown-arrow" />
              </button>

              {userDropdownOpen && (
                <>
                  <div
                    className="dropdown-overlay"
                    onClick={() => setUserDropdownOpen(false)}
                  />
                  <div className="user-dropdown-card">
                    <div className="dropdown-user-header">
                      <strong>{userDisplayName}</strong>
                      <span>{auth.user?.email || 'admin@trackin360.com'}</span>
                    </div>
                    <div className="dropdown-divider" />
                    <Link
                      to="/admin/settings"
                      className="dropdown-item"
                      onClick={() => setUserDropdownOpen(false)}
                    >
                      <UserIcon size={16} />
                      <span>Account Settings</span>
                    </Link>
                    <button
                      type="button"
                      className="dropdown-item text-danger"
                      onClick={() => {
                        setUserDropdownOpen(false)
                        handleLogout()
                      }}
                    >
                      <LogOut size={16} />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* 3. Page Content Container */}
        <main className="app-page-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
