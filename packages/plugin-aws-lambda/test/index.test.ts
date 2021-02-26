import util from 'util'
import BugsnagPluginAwsLambda from '../src/'
import Client, { EventDeliveryPayload, SessionDeliveryPayload } from '@bugsnag/core/client'

const createClient = (events: EventDeliveryPayload[], sessions: SessionDeliveryPayload[], config = {}) => {
  const client = new Client({ apiKey: 'AN_API_KEY', plugins: [BugsnagPluginAwsLambda], ...config })

  // a flush failure won't throw as we don't want to crash apps if delivery takes
  // too long. To avoid the unit tests passing when this happens, we make the logger
  // throw on any 'error' log call
  client._logger.error = (...args) => { throw new Error(util.format(args)) }

  client._delivery = {
    sendEvent (payload, cb = () => {}) {
      events.push(payload)
      cb()
    },
    sendSession (payload, cb = () => {}) {
      sessions.push(payload)
      cb()
    }
  }

  return client
}

describe('plugin: aws lambda', () => {
  it('has a name', () => {
    expect(BugsnagPluginAwsLambda.name).toBe('awsLambda')

    const client = new Client({ apiKey: 'AN_API_KEY', plugins: [BugsnagPluginAwsLambda] })
    const plugin = client.getPlugin('awsLambda')

    expect(plugin).toBeTruthy()
  })

  it('exports a "createHandler" function', () => {
    const client = new Client({ apiKey: 'AN_API_KEY', plugins: [BugsnagPluginAwsLambda] })
    const plugin = client.getPlugin('awsLambda')

    expect(plugin).toMatchObject({ createHandler: expect.any(Function) })
  })

  it('adds the context as metadata', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const handler = (event: any, context: any) => 'abc'

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(await wrappedHandler(event, context)).toBe('abc')

    expect(client.getMetadata('AWS Lambda context')).toEqual(context)
  })

  it('logs an error if flush times out', async () => {
    const client = new Client({ apiKey: 'AN_API_KEY', plugins: [BugsnagPluginAwsLambda] })
    client._logger.error = jest.fn()

    client._delivery = {
      sendEvent (payload, cb = () => {}) {
        setTimeout(cb, 250)
      },
      sendSession (payload, cb = () => {}) {
        setTimeout(cb, 250)
      }
    }

    const handler = () => {
      client.notify('hello')

      return 'abc'
    }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const timeoutError = new Error('flush timed out after 20ms')

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler({ flushTimeoutMs: 20 })
    const wrappedHandler = bugsnagHandler(handler)

    expect(await wrappedHandler(event, context)).toBe('abc')
    expect(client._logger.error).toHaveBeenCalledWith(`Delivery may be unsuccessful: ${timeoutError.message}`)
  })

  it('returns a wrapped handler that resolves to the original return value (async)', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const handler = () => 'abc'

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(await handler()).toBe('abc')
    expect(await wrappedHandler(event, context)).toBe('abc')

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('notifies when an error is thrown (async)', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const error = new Error('oh no')
    const handler = (event: any, context: any) => { throw error }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow(error)

    expect(events).toHaveLength(1)
    expect(events[0].events[0].errors[0].errorMessage).toBe(error.message)

    expect(sessions).toHaveLength(1)
  })

  it('does not notify when "autoDetectErrors" is false (async)', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions, { autoDetectErrors: false })

    const error = new Error('oh no')
    const handler = (event: any, context: any) => { throw error }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow(error)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('does not notify when "unhandledExceptions" are disabled (async)', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions, { enabledErrorTypes: { unhandledExceptions: false } })

    const error = new Error('oh no')
    const handler = (event: any, context: any) => { throw error }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow(error)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('returns a wrapped handler that resolves to the value passed to the callback (callback)', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const handler = (event: any, context: any, callback: any) => { callback(null, 'xyz') }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    expect(await wrappedHandler(event, context)).toBe('xyz')

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('notifies when an error is passed (callback)', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const error = new Error('uh oh')
    const handler = (event: any, context: any, callback: any) => { callback(error, 'xyz') }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow(error)

    expect(events).toHaveLength(1)
    expect(events[0].events[0].errors[0].errorMessage).toBe(error.message)

    expect(sessions).toHaveLength(1)
  })

  it('does not notify when "autoDetectErrors" is false (callback)', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions, { autoDetectErrors: false })

    const error = new Error('uh oh')
    const handler = (event: any, context: any, callback: any) => { callback(error, 'xyz') }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow(error)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('does not notify when "unhandledExceptions" are disabled (callback)', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions, { enabledErrorTypes: { unhandledExceptions: false } })

    const error = new Error('uh oh')
    const handler = (event: any, context: any, callback: any) => { callback(error, 'xyz') }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow(error)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('works when an async handler has the callback parameter', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const handler = async (event: any, context: any, callback: any) => 'abcxyz'

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    expect(await wrappedHandler(event, context)).toBe('abcxyz')

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('works when an async handler has the callback parameter and calls it', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const handler = async (event: any, context: any, callback: any) => { callback(null, 'abcxyz') }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    expect(await wrappedHandler(event, context)).toBe('abcxyz')

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('works when an async handler has the callback parameter and throws', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const error = new Error('abcxyz')
    const handler = async (event: any, context: any, callback: any) => { throw error }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow(error)

    expect(events).toHaveLength(1)
    expect(events[0].events[0].errors[0].errorMessage).toBe(error.message)

    expect(sessions).toHaveLength(1)
  })

  it('works when an async handler has the callback parameter and calls it with an error', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const error = new Error('abcxyz')
    const handler = async (event: any, context: any, callback: any) => { callback(error) }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow(error)

    expect(events).toHaveLength(1)
    expect(events[0].events[0].errors[0].errorMessage).toBe(error.message)

    expect(sessions).toHaveLength(1)
  })

  it('will track sessions when "autoTrackSessions" is enabled', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []
    const client = createClient(events, sessions, { autoTrackSessions: true })

    const handler = () => 'abc'

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(await wrappedHandler(event, context)).toBe('abc')

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(1)
  })

  it('will not track sessions when "autoTrackSessions" is disabled', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []
    const client = createClient(events, sessions, { autoTrackSessions: false })

    const handler = () => 'abc'

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    expect(await wrappedHandler(event, context)).toBe('abc')

    expect(events).toHaveLength(0)
    expect(sessions).toHaveLength(0)
  })

  it('sets the app.duration field on events', async () => {
    const events: EventDeliveryPayload[] = []
    const sessions: SessionDeliveryPayload[] = []

    const client = createClient(events, sessions)

    const handler = () => { throw new Error('oh no') }

    const event = { very: 'eventy' }
    const context = { extremely: 'contextual' }

    const plugin = client.getPlugin('awsLambda')

    if (!plugin) {
      throw new Error('Plugin was not loaded!')
    }

    const bugsnagHandler = plugin.createHandler()
    const wrappedHandler = bugsnagHandler(handler)

    await expect(() => wrappedHandler(event, context)).rejects.toThrow('oh no')

    expect(events).toHaveLength(1)
    expect(sessions).toHaveLength(1)

    const duration = events[0].events[0].app.duration

    expect(duration).toBeGreaterThanOrEqual(0)
    expect(duration).toBeLessThan(500)
  })
})
