'use server'

import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import { db, logActivity } from '@/lib/database'
import { createSession, destroySession, getSession, type AppRole } from '@/lib/session'

export async function login(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const user = db.prepare('SELECT id,name,role,password_hash,active FROM users WHERE email=? COLLATE NOCASE').get(email) as { id: string; name: string; role: AppRole; password_hash: string; active: number } | undefined
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) redirect('/login?error=invalid')
  await createSession({ userId: user.id, name: user.name, role: user.role })
  logActivity('USER_LOGIN', user.id)
  redirect('/')
}

export async function logout() {
  const session = await getSession()
  if (session) logActivity('USER_LOGOUT', session.userId)
  await destroySession()
  redirect('/login')
}
