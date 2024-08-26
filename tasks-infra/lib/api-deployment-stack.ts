// api-deployment-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class ApiDeploymentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, api: apigateway.RestApi, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a deployment
    const deployment = new apigateway.Deployment(this, 'TasksApiDeployment', {
      api,
    });

    // Create a stage
    new apigateway.Stage(this, 'TasksApiStage', {
      deployment,
      stageName: 'prod',
    });

    // Output the API URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.urlForPath(),
      description: 'URL of the API Gateway',
    });
  }
}