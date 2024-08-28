#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DatabaseStack } from '../lib/database-stack';
import { DbInitStack } from '../lib/db-init-stack';
import { CognitoStack } from '../lib/cognito-stack';
import { LambdaStack } from '../lib/lambda-stack';

const app = new cdk.App();

// Create a shared VPC stack
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

// Create a single DatabaseStack
const databaseStack = new DatabaseStack(app, 'DatabaseStack', {
  vpc,
  lambdaSecurityGroup,
});

// Create DbInitStack
const dbInitStack = new DbInitStack(app, 'DbInitStack', {
  vpc,
  lambdaSecurityGroup,
  database: databaseStack.database,
  databaseSecretArn: databaseStack.databaseSecretArn,
  dbName: databaseStack.dbName,
});

// Create CognitoStack
const cognitoStack = new CognitoStack(app, 'CognitoStack', {});


// Add dependencies
dbInitStack.addDependency(databaseStack);


// Synth all stacks
app.synth();