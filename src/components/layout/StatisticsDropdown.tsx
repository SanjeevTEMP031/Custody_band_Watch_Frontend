import { GraphicEq, TableChartOutlined } from '@mui/icons-material'
import HeaderDropdown from '../../pages/dashboard/HeaderDropdown'

export default function StatisticsDropdown() {
  return <HeaderDropdown id="statistics" label="Statistical management" icon={<GraphicEq />} items={[
    { label: 'Alarm statistics', icon: <TableChartOutlined />, to: '/admin/alarm-statistics' },
    { label: 'Device statistics', icon: <GraphicEq />, to: '/admin/device-statistics' },
    { label: 'User statistics', icon: <TableChartOutlined />, to: '/admin/user-statistics' },
  ]} />
}
