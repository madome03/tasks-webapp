#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DatabaseStack } from '../lib/database-stack';
import { DbInitStack } from '../lib/db-init-stack';
import { CognitoStack } from '../lib/cognito-stack';
import { LambdaStack } from '../lib/lambda-stack';
import { CognitoTriggersStack } from '../lib/cognito-triggers-stack';

const app = new cdk.App();

const stackToCreate = app.node.tryGetContext('stack');

let vpc: ec2.Vpc | undefined;
let lambdaSecurityGroup: ec2.SecurityGroup | undefined;
let databaseStack: DatabaseStack | undefined;
let cognitoStack: CognitoStack | undefined;
let cognitoTriggersStack: CognitoTriggersStack | undefined;

if (!stackToCreate || stackToCreate === 'SharedVpcStack') {
  const sharedVpcStack = new cdk.Stack(app, 'SharedVpcStack');
  vpc = new ec2.Vpc(sharedVpcStack, 'SharedVpc', {
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

  lambdaSecurityGroup = new ec2.SecurityGroup(sharedVpcStack, 'LambdaSecurityGroup', {
    vpc,
    description: 'Security group for Lambda functions',
    allowAllOutbound: true,
  });
}

if (!stackToCreate || stackToCreate === 'DatabaseStack') {
  if (!vpc || !lambdaSecurityGroup) {
    throw new Error('VPC and Lambda Security Group must be created before DatabaseStack');
  }
  databaseStack = new DatabaseStack(app, 'DatabaseStack', {
    vpc,
    lambdaSecurityGroup,
  });
}

if (!stackToCreate || stackToCreate === 'DbInitStack') {
  if (!vpc || !lambdaSecurityGroup || !databaseStack || !databaseStack.database) {
    throw new Error('VPC, Lambda Security Group, DatabaseStack, and database must be created before DbInitStack');
  }
  const dbInitStack = new DbInitStack(app, 'DbInitStack', {
    vpc,
    lambdaSecurityGroup,
    database: databaseStack.database,
    databaseSecretArn: databaseStack.databaseSecretArn,
    dbName: databaseStack.dbName,
  });
  dbInitStack.addDependency(databaseStack);
}

if (!stackToCreate || stackToCreate === 'CognitoTriggersStack') {
  if (!vpc || !lambdaSecurityGroup || !databaseStack) {
    throw new Error('VPC, Lambda Security Group, and DatabaseStack must be created before CognitoTriggersStack');
  }
  cognitoTriggersStack = new CognitoTriggersStack(app, 'CognitoTriggersStack', {
    vpc,
    lambdaSecurityGroup,
    databaseSecretArn: databaseStack.databaseSecretArn,
    dbName: databaseStack.dbName,
  });
  cognitoTriggersStack.addDependency(databaseStack);
}

if (!stackToCreate || stackToCreate === 'CognitoStack') {
  if (!cognitoTriggersStack || !cognitoTriggersStack.preSignUpFunction || !cognitoTriggersStack.postSignUpFunction) {
    throw new Error('CognitoTriggersStack and its functions must be created before CognitoStack');
  }
  cognitoStack = new CognitoStack(app, 'CognitoStack', {
    preSignUpFunctionArn: cognitoTriggersStack.preSignUpFunction.functionArn,
    postSignUpFunctionArn: cognitoTriggersStack.postSignUpFunction.functionArn,
  });
  cognitoStack.addDependency(cognitoTriggersStack);
}

if (!stackToCreate || stackToCreate === 'LambdaStack') {
  if (!vpc || !lambdaSecurityGroup || !databaseStack || !databaseStack.database || !cognitoStack || !cognitoStack.userPool || !cognitoStack.userPoolClient) {
    throw new Error('VPC, Lambda Security Group, DatabaseStack, database, CognitoStack, userPool, and userPoolClient must be created before LambdaStack');
  }
  const lambdaStack = new LambdaStack(app, 'LambdaStack', {
    vpc,
    lambdaSecurityGroup,
    database: databaseStack.database,
    databaseSecretArn: databaseStack.databaseSecretArn,
    userPool: cognitoStack.userPool,
    userPoolClient: cognitoStack.userPoolClient,
  });
  lambdaStack.addDependency(databaseStack);
  lambdaStack.addDependency(cognitoStack);
}

app.synth();