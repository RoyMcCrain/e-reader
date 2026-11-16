import { defineEnv, email } from 'void/env'

export default defineEnv({ ACCESS_ALLOWED_EMAIL: email() })
