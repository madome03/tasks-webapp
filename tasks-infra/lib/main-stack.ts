import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { DatabaseStack } from './database-stack';
import { CognitoStack } from './cognito-stack';
import { LambdaStack } from './lambda-stack';
import { APIGatewayStack } from './api-gateway-stack';

interface MainStackProps extends cdk.StackProps {
  vpc?: ec2.IVpc;
  lambdaSecurityGroup?: ec2.ISecurityGroup;
}

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: MainStackProps) {
    super(scope, id, props);

    const vpc = props?.vpc || new ec2.Vpc(this, 'TasksVpc', {
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

    const lambdaSecurityGroup = props?.lambdaSecurityGroup || new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    const databaseStack = new DatabaseStack(this, 'DatabaseStack', {
      vpc,
      lambdaSecurityGroup,
    });

    const cognitoStack = new CognitoStack(this, 'CognitoStack', {
      vpc,
      lambdaSecurityGroup,
      databaseSecretArn: databaseStack.databaseSecretArn,
      dbName: databaseStack.dbName,
    });

    const lambdaStack = new LambdaStack(this, 'LambdaStack', {
      vpc,
      lambdaSecurityGroup,
      database: databaseStack.database,
      databaseSecretArn: databaseStack.databaseSecretArn,
      userPool: cognitoStack.userPool,
      userPoolClient: cognitoStack.userPoolClient,
    });

    new APIGatewayStack(this, 'APIGatewayStack', {
      userPool: cognitoStack.userPool,
      backendFunction: lambdaStack.backendFunction,
      companyManagementFunction: lambdaStack.companyManagementFunction,
      userManagementFunction: lambdaStack.userManagementFunction,
    });

    // Ensure that DBInit runs before the other Lambdas
    lambdaStack.node.addDependency(databaseStack.dbInitCustomResource);
    cognitoStack.node.addDependency(databaseStack.dbInitCustomResource);
  }
}