import { PaidOutlined, PersonOutlined, ViewInArOutlined } from '@mui/icons-material'
import HeaderDropdown from '../../pages/dashboard/HeaderDropdown'

export default function SelfServiceDropdown() {
  return <HeaderDropdown id="self-service" label="Self-service" icon={<PersonOutlined />} width={186} items={[
    { label: 'Self-help integration', icon: <ViewInArOutlined />, to: '/admin/self-help-integration' },
    { label: 'Redeem Voucher', icon: <PaidOutlined />, to: '/admin/redeem-voucher' },
  ]} />
}
