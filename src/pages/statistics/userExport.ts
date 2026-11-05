import { utils, writeFile } from 'xlsx'
import type { ApiUser } from '../../services/api'

export function createUserWorkbook(users: ApiUser[]) {
  const sheet = utils.aoa_to_sheet([
    ['Customer Name', 'Login Name', 'Contact', 'Phone', 'Create Time'],
    ...users.map(user => [user.company ?? '', user.login_name ?? user.email, user.contact ?? user.full_name, user.phone == null ? '' : String(user.phone), user.created_at]),
  ])
  sheet['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 24 }, { wch: 20 }, { wch: 24 }]
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, 'Sheet1')
  return workbook
}

export function downloadUserWorkbook(users: ApiUser[]) {
  writeFile(createUserWorkbook(users), 'User statistics.xls', { bookType: 'biff8' })
}
