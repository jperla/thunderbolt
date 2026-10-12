/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { db as DbType } from '@/db/client'
import { getDeviceById } from '@/dal/devices'
import { APIError } from 'better-auth'
import { Elysia, type AnyElysia } from 'elysia'
import { type Auth, createAuth } from './auth'

/**
 * Resolve a session while translating credential rejection into an unauthenticated result.
 *
 * Exported because a route that calls `auth.api.getSession` directly does not
 * get this: Better Auth *throws* an `APIError` for a rejected credential — a
 * stray `x-api-key` trips its before-hook — and an unhandled throw reaches the
 * error handler as a 500 rather than the 401 it is. Any route resolving its own
 * session should come through here.
 */
export const resolveAuthSession = async (auth: Auth, headers: Headers) => {
  try {
    return await auth.api.getSession({ headers })
  } catch (error) {
    if (error instanceof APIError && (error.statusCode === 401 || error.statusCode === 403)) {
      return null
    }

    throw error
  }
}

/**
 * Reusable auth macro plugin. Use with `{ auth: true }` on routes
 * to require authentication and get typed `user`/`session` on context.
 */
export const createAuthMacro = (auth: Auth) =>
  new Elysia({ name: 'auth-macro' }).macro({
    auth: {
      async resolve({ status, request: { headers } }) {
        const session = await resolveAuthSession(auth, headers)

        if (!session?.user) {
          // The code tells the client this 401 is ours, not an upstream provider's
          // relayed through the proxy, so it can treat the session as gone.
          return status(401, { code: 'UNAUTHENTICATED' })
        }

        return {
          user: session.user,
          session: session.session,
        }
      },
    },
  })

/**
 * True for a session check from a revoked device. Revocation deletes the device's
 * sessions, so its check would otherwise read as a plain expiry and the device would
 * keep its data behind a sign-in prompt; answering this way lets it wipe itself the
 * next time it starts online.
 */
const isRevokedDeviceSessionCheck = async (database: typeof DbType, request: Request): Promise<boolean> => {
  const deviceId = request.headers.get('x-device-id')?.trim()
  if (!deviceId || !new URL(request.url).pathname.endsWith('/api/auth/get-session')) {
    return false
  }
  const device = await getDeviceById(database, deviceId)
  return device?.revokedAt != null
}

/** Create a Better Auth plugin for Elysia with the provided database. */
export const createBetterAuthPlugin = (database: typeof DbType, ipRateLimit?: AnyElysia) => {
  const auth = createAuth(database)

  const plugin = new Elysia({ name: 'better-auth' })
  if (ipRateLimit) {
    plugin.use(ipRateLimit)
  }
  // Use .all() instead of .mount() — Elysia's mount() short-circuits the
  // request pipeline before onBeforeHandle, silently bypassing rate limiting.
  // Mounted at Better Auth's basePath (under the app's /v1 prefix), not '/*': Better Auth
  // routes on whatever follows the first /api/auth, so a catch-all would let a lookalike
  // path like /v1/x/v1/api/auth/sign-in/anonymous reach it and skip the path-keyed limits.
  plugin.all(
    '/api/auth/*',
    async ({ request, status }) => {
      if (await isRevokedDeviceSessionCheck(database, request)) {
        return status(403, { code: 'DEVICE_DISCONNECTED' })
      }
      return auth.handler(request)
    },
    { parse: 'none' },
  )

  return { plugin, auth }
}

export type { Auth }
