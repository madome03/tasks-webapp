import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';

interface APIGatewayStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  backendFunction: lambda.IFunction;
  companyManagementFunction: lambda.IFunction;
  userManagementFunction: lambda.IFunction;
}

export class APIGatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: APIGatewayStackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, 'TasksApi', {
      restApiName: 'Tasks Service',
      description: 'This service serves tasks, user management, and company management.',
      deploy: true,
      deployOptions: {
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'TasksAuthorizer', {
      cognitoUserPools: [props.userPool],
    });

    const tasksIntegration = new apigateway.LambdaIntegration(props.backendFunction);
    const companyManagementIntegration = new apigateway.LambdaIntegration(props.companyManagementFunction);
    const userManagementIntegration = new apigateway.LambdaIntegration(props.userManagementFunction);

    this.createApiResources(api, tasksIntegration, companyManagementIntegration, userManagementIntegration, authorizer);

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'URL of the API Gateway',
    });
  }

  private createApiResources(
    api: apigateway.RestApi, 
    tasksIntegration: apigateway.LambdaIntegration,
    companyManagementIntegration: apigateway.LambdaIntegration,
    userManagementIntegration: apigateway.LambdaIntegration,
    authorizer: apigateway.CognitoUserPoolsAuthorizer
  ) {
    // Tasks endpoints
    const tasks = api.root.addResource('tasks');
    tasks.addMethod('GET', tasksIntegration, { authorizer });
    tasks.addMethod('POST', tasksIntegration, { authorizer });

    const task = tasks.addResource('{taskId}');
    task.addMethod('GET', tasksIntegration, { authorizer });
    task.addMethod('PUT', tasksIntegration, { authorizer });
    task.addMethod('DELETE', tasksIntegration, { authorizer });

    // Company management endpoints
    const companies = api.root.addResource('companies');
    companies.addMethod('POST', companyManagementIntegration, { authorizer });
    companies.addMethod('GET', companyManagementIntegration, { authorizer });
    
    const company = companies.addResource('{companyId}');
    company.addMethod('GET', companyManagementIntegration, { authorizer });
    company.addMethod('PUT', companyManagementIntegration, { authorizer });
    company.addMethod('DELETE', companyManagementIntegration, { authorizer });

    // User management endpoints
    const users = api.root.addResource('users');
    users.addMethod('POST', userManagementIntegration, { authorizer });
    users.addMethod('GET', userManagementIntegration, { authorizer });
    
    const user = users.addResource('{userId}');
    user.addMethod('GET', userManagementIntegration, { authorizer });
    user.addMethod('PUT', userManagementIntegration, { authorizer });
    user.addMethod('DELETE', userManagementIntegration, { authorizer });

    // Location endpoints
    const locations = api.root.addResource('locations');
    locations.addMethod('POST', companyManagementIntegration, { authorizer });
    locations.addMethod('GET', companyManagementIntegration, { authorizer });
    
    const location = locations.addResource('{locationId}');
    location.addMethod('GET', companyManagementIntegration, { authorizer });
    location.addMethod('PUT', companyManagementIntegration, { authorizer });
    location.addMethod('DELETE', companyManagementIntegration, { authorizer });
  }
}
