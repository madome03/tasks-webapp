import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'path';

interface CognitoStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  databaseSecretArn: string;
  dbName: string;
}

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly preSignUpTrigger: lambda.Function;
  public readonly postConfirmationTrigger: lambda.Function;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);
    
    this.userPool = new cognito.UserPool(this, 'TasksUserPool', {
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
        email: { required: true, mutable: false },
      },
      customAttributes: {
        company_id: new cognito.StringAttribute({ mutable: false }),
        role: new cognito.StringAttribute({ mutable: true }),
        location_id: new cognito.NumberAttribute({ mutable: true }),
        profile_type: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'TasksUserPoolClient', {
      userPool: this.userPool,
      generateSecret: false,
    });

    const commonLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_9,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // Updated this line
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
        DB_SECRET_ARN: props.databaseSecretArn,
        DB_NAME: props.dbName,
      },
    };

    // Cognito Triggers
    this.preSignUpTrigger = new lambda.Function(this, 'PreSignUpTrigger', {
      ...commonLambdaProps,
      handler: 'preSignup.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_cognito_triggers.zip')),
    });

    this.postConfirmationTrigger = new lambda.Function(this, 'PostConfirmationTrigger', {
      ...commonLambdaProps,
      handler: 'postSignup.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_cognito_triggers.zip')),
    });

    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, this.preSignUpTrigger);
    this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, this.postConfirmationTrigger);

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'ID of the Cognito User Pool',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'ID of the Cognito User Pool Client',
    });
  }
}