import { MyLocationOutlined, PeopleAlt } from '@mui/icons-material'
import HeaderDropdown from '../../pages/dashboard/HeaderDropdown'

export default function ManageDropdown() {
  return <HeaderDropdown id="manage" label="Manage" icon={<PeopleAlt />} width={198} items={[
    { label: 'Device Management', icon: <PeopleAlt />, to: '/admin/device-management' },
    { label: 'Monitoring Center', icon: <MyLocationOutlined />, to: '/admin/monitoring-center' },
    { label: 'Health Data', icon: <PeopleAlt />, to: '/admin/health-data' },
  ]} />
}
