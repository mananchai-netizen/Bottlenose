import { EntitySchema } from 'typeorm'
import type { MachineConfig } from '../types'

export interface MachineConfigRecord {
  id: number
  config: MachineConfig
  updated_at: Date
}

export const MachineConfigEntity = new EntitySchema<MachineConfigRecord>({
  name: 'MachineConfig',
  tableName: 'machine_config',
  columns: {
    id:         { type: Number, primary: true, default: 1 },
    config:     { type: 'jsonb' },
    updated_at: { type: Date, updateDate: true },
  },
})
