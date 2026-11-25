import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export type AppRole = 'SUPER_ADMIN' | 'HOSPITAL_ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'NURSE' | 'LAB_TECHNICIAN' | 'PHARMACIST' | 'ACCOUNTANT'
type Session = { userId: string; name: string; role: AppRole; exp: number }
const cookieName = 'medicare_session'
const secret = () => process.env.SESSION_SECRET || ''
const sign = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url')

export async function createSession(user: Omit<Session, 'exp'>) {
  if (secret().length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.')
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url')
  const jar = await cookies()
  jar.set(cookieName, `${payload}.${sign(payload)}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 })
}

export async function destroySession() {
  const jar = await cookies()
  jar.delete(cookieName)
}

export async function getSession(): Promise<Session | null> {
  if (secret().length < 32) return null
  const token = (await cookies()).get(cookieName)?.value
  if (!token) return null
  const [payload, supplied] = token.split('.')
  if (!payload || !supplied) return null
  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(supplied)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session
    return value.exp > Date.now() ? value : null
  } catch { return null }
}

export async function requireRole(allowed: AppRole[]) {
  const session = await getSession()
  if (!session) throw new Error('UNAUTHORIZED')
  if (!allowed.includes(session.role)) throw new Error('FORBIDDEN')
  return session
}

export async function requirePageSession() {
  const session = await getSession()
  if (!session) redirect('/login')
  return session
}
