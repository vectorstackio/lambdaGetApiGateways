// handler.ts

import {
  APIGatewayClient,
  GetRestApisCommand
} from '@aws-sdk/client-api-gateway'

import {
  ApiGatewayV2Client,
  GetApisCommand
} from '@aws-sdk/client-apigatewayv2'


const restClient =
  new APIGatewayClient({})


const v2Client =
  new ApiGatewayV2Client({})


export const handler = async () => {

  try {

    const restApis = []

    let restPosition: string | undefined


    do {

      const command =
        new GetRestApisCommand({
          position:
            restPosition
        })


      const response =
        await restClient.send(command)


      if (response.items) {
        restApis.push(
          ...response.items
        )
      }


      restPosition =
        response.position

    } while (restPosition)


    const v2Apis = []

    let v2NextToken: string | undefined


    do {

      const command =
        new GetApisCommand({
          nextToken:
            v2NextToken
        })


      const response =
        await v2Client.send(command)


      if (response.Items) {
        v2Apis.push(
          ...response.Items
        )
      }


      v2NextToken =
        response.NextToken

    } while (v2NextToken)


    return {

      statusCode: 200,

      headers: {
        'Content-Type':
          'application/json'
      },

      body: JSON.stringify({

        restApis,

        v2Apis

      })

    }

  } catch (error) {

    console.error(
      'Failed to list API Gateways:',
      error
    )


    return {

      statusCode: 500,

      headers: {
        'Content-Type':
          'application/json'
      },

      body: JSON.stringify({

        error:
          'Failed to list API Gateways'

      })

    }

  }

}