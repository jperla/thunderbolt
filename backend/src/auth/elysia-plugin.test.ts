/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { user } from '@/db/auth-schema'
import { devicesTable } from '@/db/powersync-schema'
import { authHeaders, createTestApp, type TestAppHandle } from '@/test-utils/e2e'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

const getSession = (handle: TestAppHandle, headers: Record<string, string>) =>
  handle.app.handle(new Request('http://localhost/v1/api/auth/get-session', { headers }))

describe('session check from a revoked device', () => {
  let handle: TestAppHandle

  beforeEach(async () => {
    handle = await createTestApp()
    const [{ id: userId }] = await handle.db.select({ id: user.id }).from(user).where(eq(user.email, handle.email))
    await handle.db.insert(devicesTable).values([
      { id: 'device-revoked', userId, trusted: true, revokedAt: new Date() },
      { id: 'device-active', userId, trusted: true },
    ])
  })

  afterEach(async () => {
    await handle.cleanup()
  })

  it('answers 403 DEVICE_DISCONNECTED so the device can wipe itself', async () => {
    const response = await getSession(handle, { ...authHeaders(handle.bearerToken), 'X-Device-ID': 'device-revoked' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'DEVICE_DISCONNECTED' })
  })

  it('still answers once the token is gone, since an earlier 401 may have cleared it', async () => {
    const response = await getSession(handle, { 'X-Device-ID': 'device-revoked' })

    expect(response.status).toBe(403)
  })

  it('leaves an active device alone', async () => {
    const response = await getSession(handle, { ...authHeaders(handle.bearerToken), 'X-Device-ID': 'device-active' })

    expect(response.status).toBe(200)
    expect((await response.json())?.user?.email).toBe(handle.email)
  })
})
