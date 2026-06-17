import { DataSource } from 'typeorm'
import { UserEntity } from './entities/User'
import { MachineConfigEntity } from './entities/MachineConfig'
import { ProjectConfigEntity } from './entities/ProjectConfig'

let _dataSource: DataSource | null = null

export function getDataSource(): DataSource {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  if (_dataSource === null) {
    _dataSource = new DataSource({
      type: 'postgres',
      url,
      entities: [UserEntity, MachineConfigEntity, ProjectConfigEntity],
      synchronize: false,
      ssl: url.includes('sslmode=require') || url.startsWith('rediss')
        ? { rejectUnauthorized: false }
        : false,
    })
  }
  return _dataSource
}

export async function getInitializedDataSource(): Promise<DataSource> {
  const ds = getDataSource()
  if (!ds.isInitialized) await ds.initialize()
  return ds
}
