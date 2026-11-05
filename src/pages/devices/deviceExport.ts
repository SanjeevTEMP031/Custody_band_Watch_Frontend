import { utils, writeFile } from 'xlsx'
import type { Device } from '../../services/api'

export function createDeviceWorkbook(devices: Device[]) {
  const rows = [
    ['Company Name', 'Device Name', 'Imei', 'Device SIM', 'Device Model', 'Create Time', 'Activate Time', 'Device expire time', 'Last communication time'],
    ...devices.map(device => [
      device.company ?? '', device.device_name ?? device.serial_number,
      device.imei == null ? '' : String(device.imei), device.device_sim ?? '',
      device.device_model ?? '', device.created_at ?? '', device.activation_time ?? '',
      device.expire_time ?? '', device.last_seen ?? '',
    ]),
  ]
  const sheet = utils.aoa_to_sheet(rows)
  sheet['!cols'] = rows[0].map(() => ({ wch: 24 }))
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, 'Sheet1')
  return workbook
}

export function downloadDeviceWorkbook(devices: Device[]) {
  writeFile(createDeviceWorkbook(devices), 'Device statistics.xls', { bookType: 'biff8' })
}
