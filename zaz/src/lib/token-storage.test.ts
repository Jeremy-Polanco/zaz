/**
 * token-storage tests.
 *
 * Strategy: jest.isolateModules() per test to reset the module-level
 * `migrationRan` flag inside token-storage.ts, then require inside the
 * isolation block to get a fresh module instance each time.
 *
 * The expo-secure-store mock is registered globally in src/test/setup.ts.
 */

// These keys must match the constants in token-storage.ts
const ACCESS_KEY = 'zaz.access_token'
const REFRESH_KEY = 'zaz.refresh_token'
const LEGACY_ACCESS_KEY = 'zaz.accessToken'
const LEGACY_REFRESH_KEY = 'zaz.refreshToken'

function getStoreMock() {
  return jest.requireMock('expo-secure-store') as {
    getItemAsync: jest.Mock
    setItemAsync: jest.Mock
    deleteItemAsync: jest.Mock
  }
}

function getAsyncStorageMock() {
  return (
    jest.requireMock('@react-native-async-storage/async-storage') as {
      default: { getItem: jest.Mock; setItem: jest.Mock; removeItem: jest.Mock }
    }
  ).default
}

beforeEach(() => {
  const store = getStoreMock()
  store.getItemAsync.mockReset().mockResolvedValue(null)
  store.setItemAsync.mockReset().mockResolvedValue(undefined)
  store.deleteItemAsync.mockReset().mockResolvedValue(undefined)

  const as = getAsyncStorageMock()
  as.getItem.mockReset().mockResolvedValue(null)
  as.removeItem.mockReset?.()
})

describe('token-storage — SecureStore integration', () => {
  it('getAccessToken returns null when SecureStore has no token', async () => {
    let getAccessToken!: () => Promise<string | null>
    jest.isolateModules(() => {
      ;({ getAccessToken } = require('./token-storage') as typeof import('./token-storage'))
    })
    const result = await getAccessToken()
    expect(result).toBeNull()
  })

  it('setAccessToken stores value under the correct key', async () => {
    let setAccessToken!: (v: string) => Promise<void>
    jest.isolateModules(() => {
      ;({ setAccessToken } = require('./token-storage') as typeof import('./token-storage'))
    })
    await setAccessToken('my-access-token')
    expect(getStoreMock().setItemAsync).toHaveBeenCalledWith(ACCESS_KEY, 'my-access-token')
  })

  it('getAccessToken retrieves the stored value', async () => {
    getStoreMock().getItemAsync.mockResolvedValueOnce('stored-token')
    let getAccessToken!: () => Promise<string | null>
    jest.isolateModules(() => {
      ;({ getAccessToken } = require('./token-storage') as typeof import('./token-storage'))
    })
    const result = await getAccessToken()
    expect(result).toBe('stored-token')
  })

  it('setRefreshToken stores value under the refresh key', async () => {
    let setRefreshToken!: (v: string) => Promise<void>
    jest.isolateModules(() => {
      ;({ setRefreshToken } = require('./token-storage') as typeof import('./token-storage'))
    })
    await setRefreshToken('my-refresh-token')
    expect(getStoreMock().setItemAsync).toHaveBeenCalledWith(REFRESH_KEY, 'my-refresh-token')
  })

  it('clearTokens deletes both access and refresh keys', async () => {
    let clearTokens!: () => Promise<void>
    jest.isolateModules(() => {
      ;({ clearTokens } = require('./token-storage') as typeof import('./token-storage'))
    })
    await clearTokens()
    const store = getStoreMock()
    expect(store.deleteItemAsync).toHaveBeenCalledWith(ACCESS_KEY)
    expect(store.deleteItemAsync).toHaveBeenCalledWith(REFRESH_KEY)
  })

  it('migration runs once — migrates old tokens from AsyncStorage to SecureStore', async () => {
    const as = getAsyncStorageMock()
    as.getItem
      .mockResolvedValueOnce('old-access')  // LEGACY_ACCESS_KEY
      .mockResolvedValueOnce('old-refresh') // LEGACY_REFRESH_KEY

    let getAccessToken!: () => Promise<string | null>
    jest.isolateModules(() => {
      ;({ getAccessToken } = require('./token-storage') as typeof import('./token-storage'))
    })
    await getAccessToken() // triggers migration

    const store = getStoreMock()
    expect(store.setItemAsync).toHaveBeenCalledWith(ACCESS_KEY, 'old-access')
    expect(store.setItemAsync).toHaveBeenCalledWith(REFRESH_KEY, 'old-refresh')
    expect(as.removeItem).toHaveBeenCalledWith(LEGACY_ACCESS_KEY)
    expect(as.removeItem).toHaveBeenCalledWith(LEGACY_REFRESH_KEY)
  })

  it('migration runs only once even after multiple calls', async () => {
    const as = getAsyncStorageMock()
    as.getItem.mockResolvedValue(null)

    let getAccessToken!: () => Promise<string | null>
    // isolateModules gives us a fresh module with migrationRan = false
    jest.isolateModules(() => {
      ;({ getAccessToken } = require('./token-storage') as typeof import('./token-storage'))
    })
    // call three times — migration should only run once
    await getAccessToken()
    await getAccessToken()
    await getAccessToken()

    // getItem is called twice per migration run (access + refresh legacy keys).
    // With migrationRan guard, it should only be called twice total.
    const migrationCalls = as.getItem.mock.calls.filter(
      ([key]: [string]) => key === LEGACY_ACCESS_KEY || key === LEGACY_REFRESH_KEY,
    )
    expect(migrationCalls.length).toBe(2)
    // No old tokens → setItemAsync should not be called
    expect(getStoreMock().setItemAsync).not.toHaveBeenCalled()
  })
})
