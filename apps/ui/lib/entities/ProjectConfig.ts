import { EntitySchema } from 'typeorm'
import type { ProjectConfig } from '../types'

export interface ProjectConfigRecord {
  project_id: string
  config: ProjectConfig
  updated_at: Date
}

export const ProjectConfigEntity = new EntitySchema<ProjectConfigRecord>({
  name: 'ProjectConfig',
  tableName: 'project_configs',
  columns: {
    project_id: { type: String, primary: true },
    config:     { type: 'jsonb' },
    updated_at: { type: Date, updateDate: true },
  },
})
