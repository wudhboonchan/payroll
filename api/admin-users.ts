import { createClient } from '@supabase/supabase-js'
import process from 'node:process'

type Role = 'superUser' | 'admin' | 'normalUser'

interface ApiRequest {
  method?: string
  headers: { authorization?: string }
  body?: Record<string, unknown>
}

interface ApiResponse {
  status: (statusCode: number) => ApiResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
}

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function send(res: ApiResponse, status: number, body: unknown) {
  res.status(status).json(body)
}

function getBearerToken(req: ApiRequest) {
  const header = req.headers.authorization
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : null
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { error: 'Server authentication is not configured' })
  }

  if (!req.method || !['POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'POST, DELETE')
    return send(res, 405, { error: 'Method not allowed' })
  }

  const accessToken = getBearerToken(req)
  if (!accessToken) return send(res, 401, { error: 'Missing access token' })

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken)
  if (authError || !authData.user) return send(res, 401, { error: 'Invalid session' })

  const { data: caller, error: callerError } = await admin
    .from('profiles')
    .select('id, role, factory_id')
    .eq('id', authData.user.id)
    .single()

  if (callerError || !caller || !['superUser', 'admin'].includes(caller.role)) {
    return send(res, 403, { error: 'You are not allowed to manage users' })
  }

  async function factoryExists(factoryId: string) {
    const { data } = await admin.from('factories').select('id').eq('id', factoryId).maybeSingle()
    return Boolean(data)
  }

  if (req.method === 'POST') {
    const { email, password, full_name, factory_id } = req.body ?? {}
    const requestedRole = (req.body?.role ?? 'normalUser') as Role

    if (
      typeof email !== 'string'
      || typeof password !== 'string'
      || typeof full_name !== 'string'
      || typeof factory_id !== 'string'
    ) {
      return send(res, 400, { error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' })
    }
    if (password.length < 8) {
      return send(res, 400, { error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
    }
    if (!['superUser', 'admin', 'normalUser'].includes(requestedRole)) {
      return send(res, 400, { error: 'Invalid role' })
    }
    if (requestedRole === 'superUser' || (requestedRole === 'admin' && caller.role !== 'superUser')) {
      return send(res, 403, { error: 'Only a SuperUser can create an administrator' })
    }
    if (caller.role === 'admin' && factory_id !== caller.factory_id) {
      return send(res, 403, { error: 'Administrators can only manage their own factory' })
    }
    if (!(await factoryExists(factory_id))) {
      return send(res, 400, { error: 'Factory not found' })
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError || !created.user) {
      return send(res, 400, { error: createError?.message ?? 'Unable to create user' })
    }

    // Production handle_new_user already inserts the profile during createUser.
    const { error: profileError } = await admin.from('profiles').upsert({
      id: created.user.id,
      full_name,
      role: requestedRole,
      factory_id,
    }, { onConflict: 'id' })

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return send(res, 400, { error: profileError.message })
    }

    return send(res, 201, { id: created.user.id })
  }

  const targetUserId = req.body?.id
  if (typeof targetUserId !== 'string') return send(res, 400, { error: 'Missing user id' })
  if (targetUserId === authData.user.id) {
    return send(res, 400, { error: 'You cannot delete your own account' })
  }

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, role, factory_id')
    .eq('id', targetUserId)
    .single()

  if (targetError || !target) return send(res, 404, { error: 'User not found' })
  if (caller.role === 'admin' && target.factory_id !== caller.factory_id) {
    return send(res, 403, { error: 'Administrators can only manage their own factory' })
  }
  const callerCanDeleteTarget = target.role === 'normalUser'
    || (caller.role === 'superUser' && target.role === 'admin')
  if (!callerCanDeleteTarget) {
    return send(res, 403, { error: 'You are not allowed to delete this account' })
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId)
  if (deleteError) return send(res, 400, { error: deleteError.message })
  return send(res, 200, { ok: true })
}
