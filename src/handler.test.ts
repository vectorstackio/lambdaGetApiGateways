import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GetRestApisCommand } from '@aws-sdk/client-api-gateway'
import { GetApisCommand } from '@aws-sdk/client-apigatewayv2'

const { restSend, v2Send } = vi.hoisted(() => ({
  restSend: vi.fn(),
  v2Send: vi.fn()
}))

vi.mock('@aws-sdk/client-api-gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-api-gateway')>()
  return { ...actual, APIGatewayClient: class { send = restSend } }
})
vi.mock('@aws-sdk/client-apigatewayv2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-apigatewayv2')>()
  return { ...actual, ApiGatewayV2Client: class { send = v2Send } }
})

import { handler } from './handler'

const headers = { 'Content-Type': 'application/json' }
const failure = {
  statusCode: 500,
  headers,
  body: JSON.stringify({ error: 'Internal server error in getApiGateways lambda' })
}

beforeEach(() => {
  vi.resetAllMocks()
  restSend.mockResolvedValue({})
  v2Send.mockResolvedValue({})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('handler', () => {
  it('returns both kinds of API with JSON headers', async () => {
    const rest = { id: 'rest-1', name: 'REST' }
    const v2 = { ApiId: 'v2-1', Name: 'HTTP' }
    restSend.mockResolvedValue({ items: [rest] })
    v2Send.mockResolvedValue({ Items: [v2] })

    expect(await handler()).toEqual({
      statusCode: 200,
      headers,
      body: JSON.stringify({ restApis: [rest], v2Apis: [v2] })
    })
    expect(restSend.mock.calls[0][0]).toBeInstanceOf(GetRestApisCommand)
    expect(restSend.mock.calls[0][0].input).toEqual({ position: undefined })
    expect(v2Send.mock.calls[0][0]).toBeInstanceOf(GetApisCommand)
    expect(v2Send.mock.calls[0][0].input).toEqual({ NextToken: undefined })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('collects every page and passes each continuation token', async () => {
    restSend.mockResolvedValueOnce({ items: [{ id: 'a' }], position: 'rest-next' })
      .mockResolvedValueOnce({ items: [{ id: 'b' }] })
    v2Send.mockResolvedValueOnce({ Items: [{ ApiId: 'c' }], NextToken: 'v2-next' })
      .mockResolvedValueOnce({ Items: [{ ApiId: 'd' }] })

    const result = await handler()
    expect(JSON.parse(result.body)).toEqual({
      restApis: [{ id: 'a' }, { id: 'b' }],
      v2Apis: [{ ApiId: 'c' }, { ApiId: 'd' }]
    })
    expect(restSend).toHaveBeenCalledTimes(2)
    expect(v2Send).toHaveBeenCalledTimes(2)
    expect(restSend.mock.calls[1][0].input).toEqual({ position: 'rest-next' })
    expect(v2Send.mock.calls[1][0].input).toEqual({ NextToken: 'v2-next' })
  })

  it('handles missing lists on intermediate pages and empty final lists', async () => {
    restSend.mockResolvedValueOnce({ position: 'next' }).mockResolvedValueOnce({ items: [] })
    v2Send.mockResolvedValueOnce({ NextToken: 'next' }).mockResolvedValueOnce({ Items: [] })
    expect(JSON.parse((await handler()).body)).toEqual({ restApis: [], v2Apis: [] })
    expect(restSend).toHaveBeenCalledTimes(2)
    expect(v2Send).toHaveBeenCalledTimes(2)
  })

  it('treats empty continuation tokens as the end of pagination', async () => {
    restSend.mockResolvedValue({ items: [], position: '' })
    v2Send.mockResolvedValue({ Items: [], NextToken: '' })
    expect((await handler()).statusCode).toBe(200)
    expect(restSend).toHaveBeenCalledTimes(1)
    expect(v2Send).toHaveBeenCalledTimes(1)
  })

  it.each(['rest', 'v2'] as const)('returns a generic error when %s fails without logging secrets', async (client) => {
    const secret = 'private-token-and-account-id'
    const error = new Error(secret)
    Object.assign(error, { credentials: secret })
    ;(client === 'rest' ? restSend : v2Send).mockRejectedValue(error)

    expect(await handler()).toEqual(failure)
    expect(console.error).toHaveBeenCalledWith('Failed to list API Gateways')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret)
    expect(console.log).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    if (client === 'rest') expect(v2Send).not.toHaveBeenCalled()
  })

  it('handles a failure on a later page without returning partial results', async () => {
    restSend.mockResolvedValueOnce({ items: [{ id: 'a' }], position: 'next' })
      .mockRejectedValueOnce('sensitive rejection')
    expect(await handler()).toEqual(failure)
    expect(v2Send).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive rejection')
  })

  it('handles malformed AWS responses as errors', async () => {
    restSend.mockResolvedValue({ items: 42 })
    expect(await handler()).toEqual(failure)
    expect(v2Send).not.toHaveBeenCalled()
  })
})
