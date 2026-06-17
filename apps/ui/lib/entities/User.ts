import { EntitySchema } from 'typeorm'

export interface UserRecord {
  username: string
  password: string
  role: string
  created_at: Date
}

export const UserEntity = new EntitySchema<UserRecord>({
  name: 'User',
  tableName: 'users',
  columns: {
    username: { type: String, primary: true },
    password: { type: String },
    role:     { type: String, default: 'admin' },
    created_at: { type: Date, nullable: true },
  },
})
