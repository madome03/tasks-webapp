#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { MainStack } from '../lib/main-stack';
import { DatabaseStack } from '../lib/database-stack';
import { DbInitStack } from '../lib/db-init-stack';
import { CognitoStack } from '../lib/cognito-stack';
import { LambdaStack } from '../lib/lambda-stack';
import { APIGatewayStack } from '../lib/api-gateway-stack';

const app = new cdk.App();

const stackName = process.argv[2];

// Create a shared VPC
const sharedVpcStack = new cdk.Stack(app, 'SharedVpcStack');
const vpc = new ec2.Vpc(sharedVpcStack, 'SharedVpc', {
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'Public',
      subnetType: ec2.SubnetType.PUBLIC,
    },
    {
      cidrMask: 24,
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
  ],
});

const lambdaSecurityGroup = new ec2.SecurityGroup(sharedVpcStack, 'LambdaSecurityGroup', {
  vpc,
  description: 'Security group for Lambda functions',
  allowAllOutbound: true,
});

switch (stackName) {
  case 'MainStack':
    new MainStack(app, 'MainStack', {
      vpc,
      lambdaSecurityGroup,
    });
    break;
  case 'DatabaseStack':
    new DatabaseStack(app, 'DatabaseStack', {
      vpc,
      lambdaSecurityGroup,
    });
    break;
  case 'DbInitStack':
    const databaseStackForDbInit = new DatabaseStack(app, 'DatabaseStackForDbInit', {
      vpc,
      lambdaSecurityGroup,
    });
    new DbInitStack(app, 'DbInitStack', {
      vpc,
      lambdaSecurityGroup,
      database: databaseStackForDbInit.database,
      databaseSecretArn: databaseStackForDbInit.databaseSecretArn,
      dbName: databaseStackForDbInit.dbName,
    });
    break;
  case 'CognitoStack':
    const databaseStackForCognito = new DatabaseStack(app, 'DatabaseStackForCognito', {
      vpc,
      lambdaSecurityGroup,
    });
    new CognitoStack(app, 'CognitoStack', {
      vpc,
      lambdaSecurityGroup,
      databaseSecretArn: databaseStackForCognito.databaseSecretArn,
      dbName: databaseStackForCognito.dbName,
    });
    break;
  case 'LambdaStack':
    const databaseStackForLambda = new DatabaseStack(app, 'DatabaseStackForLambda', {
      vpc,
      lambdaSecurityGroup,
    });
    const dbInitStackForLambda = new DbInitStack(app, 'DbInitStackForLambda', {
      vpc,
      lambdaSecurityGroup,
      database: databaseStackForLambda.database,
      databaseSecretArn: databaseStackForLambda.databaseSecretArn,
      dbName: databaseStackForLambda.dbName,
    });
    const cognitoStackForLambda = new CognitoStack(app, 'CognitoStackForLambda', {
      vpc,
      lambdaSecurityGroup,
      databaseSecretArn: databaseStackForLambda.databaseSecretArn,
      dbName: databaseStackForLambda.dbName,
    });
    new LambdaStack(app, 'LambdaStack', {
      vpc,
      lambdaSecurityGroup,
      database: databaseStackForLambda.database,
      databaseSecretArn: databaseStackForLambda.databaseSecretArn,
      userPool: cognitoStackForLambda.userPool,
      userPoolClient: cognitoStackForLambda.userPoolClient,
    });
    break;
  case 'APIGatewayStack':
    const databaseStackForApiGateway = new DatabaseStack(app, 'DatabaseStackForApiGateway', {
      vpc,
      lambdaSecurityGroup,
    });
    const dbInitStackForApiGateway = new DbInitStack(app, 'DbInitStackForApiGateway', {
      vpc,
      lambdaSecurityGroup,
      database: databaseStackForApiGateway.database,
      databaseSecretArn: databaseStackForApiGateway.databaseSecretArn,
      dbName: databaseStackForApiGateway.dbName,
    });
    const cognitoStackForApiGateway = new CognitoStack(app, 'CognitoStackForApiGateway', {
      vpc,
      lambdaSecurityGroup,
      databaseSecretArn: databaseStackForApiGateway.databaseSecretArn,
      dbName: databaseStackForApiGateway.dbName,
    });
    const lambdaStackForApiGateway = new LambdaStack(app, 'LambdaStackForApiGateway', {
      vpc,
      lambdaSecurityGroup,
      database: databaseStackForApiGateway.database,
      databaseSecretArn: databaseStackForApiGateway.databaseSecretArn,
      userPool: cognitoStackForApiGateway.userPool,
      userPoolClient: cognitoStackForApiGateway.userPoolClient,
    });
    new APIGatewayStack(app, 'APIGatewayStack', {
      userPool: cognitoStackForApiGateway.userPool,
      backendFunction: lambdaStackForApiGateway.backendFunction,
      companyManagementFunction: lambdaStackForApiGateway.companyManagementFunction,
      userManagementFunction: lambdaStackForApiGateway.userManagementFunction,
    });
    break;
  default:
    console.error(`Unknown stack: ${stackName}`);
    process.exit(1);
}